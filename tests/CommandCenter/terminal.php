<?php
declare(strict_types=1);

require dirname(__DIR__) . '/bootstrap.php';

use Pimcore\Bundle\StudioBackendBundle\Security\Service\SecurityServiceInterface;
use Pimcore\Cache\RuntimeCache;
use Pimcore\Model\DataObject;
use Pimcore\Model\Element\ElementInterface;
use Pimcore\Model\User;
use Pimcore\Model\UserInterface;
use Symfony\Component\Config\Definition\Processor;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\ServiceUnavailableHttpException;
use Symfony\Component\Security\Csrf\CsrfTokenManager;
use Symfony\Component\Security\Csrf\TokenStorage\SessionTokenStorage;
use Watza\CommandCenterBundle\DependencyInjection\Configuration;
use Watza\CommandCenterBundle\Parameter\TerminalConsumeParameters;
use Watza\CommandCenterBundle\Parameter\TerminalTicketParameters;
use Watza\CommandCenterBundle\Service\CommandCenterService;
use Watza\CommandCenterBundle\Service\PrivateJsonStorage;
use Watza\CommandCenterBundle\Service\TerminalService;

$directory = sys_get_temp_dir() . '/command-terminal-' . bin2hex(random_bytes(8));
$storage = new PrivateJsonStorage($directory);
$request = Request::create('/terminal', 'POST');
$request->setSession(new Session(new MockArraySessionStorage()));
$request->getSession()->start();
$request->headers->set('Origin', 'https://studio.test');
$requests = new RequestStack();
$requests->push($request);
$csrf = new CsrfTokenManager(storage: new SessionTokenStorage($requests));
$token = $csrf->getToken('command-center')->getValue();
$user = new User();
$user->setId(101);
$user->setAdmin(true);
$user->setActive(true);
RuntimeCache::set('user_101', $user);
$security = new class ($user) implements SecurityServiceInterface {
    public function __construct(public User $user) {}
    public function getCurrentUser(): UserInterface { return $this->user; }
    public function isLoggedIn(): bool { return true; }
    public function hasElementPermission(ElementInterface $element, UserInterface $user, string $permission): void {}
    public function hasElementPermissions(ElementInterface $element, UserInterface $user, array $permissions): void {}
    public function getSpecialDataObjectPermissions(DataObject $object, UserInterface $user, string $permission): array
    {
        return [];
    }
};
$config = [
    'enabled' => true, 'secret' => str_repeat('s', 40), 'origin' => 'https://studio.test',
    'websocket_path' => '/command-center-terminal',
];
$commands = new CommandCenterService($csrf, '/not-used', 'test');
$service = new TerminalService($storage, $commands, $security, $requests, $config);
$check = static function (bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
};
$reject = static function (callable $action, string $type = AccessDeniedHttpException::class): void {
    try { $action(); } catch (Throwable $error) {
        if ($error instanceof $type) return;
        throw $error;
    }
    throw new RuntimeException('Unsafe terminal request accepted.');
};
$issue = static fn (?string $id = null): array => $service->issue(new TerminalTicketParameters($token, $id));
$consume = static fn (array $ticket): array => $service->consume(new TerminalConsumeParameters($ticket['ticket']));
$authorize = static fn () => $request->headers->set('Authorization', 'Bearer ' . $config['secret']);
try {
    $defaults = (new Processor())->processConfiguration(new Configuration(), []);
    $check($defaults['terminal']['enabled'] === false, 'Terminal enabled by default.');
    $disabled = new TerminalService($storage, $commands, $security, $requests, [
        ...$config, 'enabled' => false,
    ]);
    $check($disabled->settings() === ['enabled' => false], 'Disabled setting missing.');
    $reject(fn () => $disabled->issue(new TerminalTicketParameters($token)), ServiceUnavailableHttpException::class);
    $reject(fn () => $service->issue(new TerminalTicketParameters('invalid')));
    $user->setAdmin(false);
    $reject(fn () => $service->settings());
    $reject($issue);
    $user->setAdmin(true);
    $user->setActive(false);
    $reject($issue);
    $user->setActive(true);
    $request->headers->set('Origin', 'https://attacker.test');
    $reject($issue);
    $request->headers->set('Origin', 'https://studio.test');
    $reject(fn () => $issue('../other'));
    $ticket = $issue();
    $check(!str_contains(file_get_contents($directory . '/terminal/tickets.json'), $ticket['ticket']),
        'Raw ticket persisted.');
    $reject(fn () => $consume($ticket));
    $authorize();
    $identity = $consume($ticket);
    $check($identity['sessionId'] === null && strlen($identity['owner']) === 64, 'Identity missing.');
    $reject(fn () => $consume($ticket));
    $resumed = $consume($issue(str_repeat('a', 32)));
    $check($resumed['sessionId'] === str_repeat('a', 32) && $resumed['owner'] === $identity['owner'],
        'Reconnect lost its owner/session binding.');
    $request->getSession()->migrate();
    $other = $consume($issue());
    $check($other['owner'] !== $identity['owner'], 'Different Studio sessions share terminal ownership.');
    $user->setId(102);
    RuntimeCache::set('user_102', $user);
    $anotherUser = $consume($issue());
    $check($anotherUser['owner'] !== $other['owner'], 'Different users share terminal ownership.');
    $expired = $issue();
    $storage->transaction('terminal', 'tickets', static function (?array &$tickets): void {
        foreach ($tickets as &$item) $item['expires'] = time() - 1;
    });
    $reject(fn () => $consume($expired));
    $revoked = $issue();
    $user->setAdmin(false);
    $reject(fn () => $consume($revoked));
    $user->setAdmin(true);
    $reject(fn () => $consume($revoked));
    $inactive = $issue();
    $user->setActive(false);
    $reject(fn () => $consume($inactive));
    $user->setActive(true);
    $check(!is_dir($directory . '/history'), 'Terminal wrote command history.');
} finally {
    foreach (glob($directory . '/terminal/*') ?: [] as $file) unlink($file);
    if (is_dir($directory . '/terminal')) rmdir($directory . '/terminal');
    if (is_dir($directory)) rmdir($directory);
    RuntimeCache::set('user_101', null);
    RuntimeCache::set('user_102', null);
}
echo "Terminal admin, CSRF, origin, ticket expiry/replay and owner checks passed.\n";
