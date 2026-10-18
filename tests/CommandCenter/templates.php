<?php
declare(strict_types=1);

require dirname(__DIR__) . '/bootstrap.php';

use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\Security\Csrf\CsrfTokenManager;
use Watza\CommandCenterBundle\Parameter\TemplateActionParameters;
use Watza\CommandCenterBundle\Parameter\TemplateSaveParameters;
use Watza\CommandCenterBundle\Preview\CommandPreviewProviderInterface;
use Watza\CommandCenterBundle\Preview\CommandPreviewResult;
use Watza\CommandCenterBundle\Service\CommandCenterService;
use Watza\CommandCenterBundle\Service\CommandHistoryStore;
use Watza\CommandCenterBundle\Service\CommandTemplateService;
use Watza\CommandCenterBundle\Service\PrivateJsonStorage;

session_save_path(sys_get_temp_dir());
$directory = sys_get_temp_dir() . '/command-templates-' . bin2hex(random_bytes(8));
mkdir($directory . '/bin', 0700, true);
file_put_contents($directory . '/bin/console', <<<'PHP'
<?php
if ($argv[4] === 'list') {
    echo json_encode(['commands' => [['name' => 'test:preview'], ['name' => 'test:unsupported']]]); exit;
}
file_put_contents(__DIR__ . '/../executed', json_encode(array_slice($argv, 4)));
echo 'template-executed';
PHP);
$csrf = new CsrfTokenManager();
$token = $csrf->getToken('command-center')->getValue();
$storage = new PrivateJsonStorage($directory . '/data');
$history = new CommandHistoryStore($storage);
$security = new class implements \Pimcore\Bundle\StudioBackendBundle\Security\Service\SecurityServiceInterface {
    public function getCurrentUser(): \Pimcore\Model\User {
        $user = new \Pimcore\Model\User(); $user->setId(101); $user->setName('test-admin'); $user->setAdmin(true);
        return $user;
    }
    public function isLoggedIn(): bool { return true; }
    public function hasElementPermission(\Pimcore\Model\Element\ElementInterface $element, \Pimcore\Model\UserInterface $user, string $permission): void {}
    public function hasElementPermissions(\Pimcore\Model\Element\ElementInterface $element, \Pimcore\Model\UserInterface $user, array $permissions): void {}
    public function getSpecialDataObjectPermissions(\Pimcore\Model\DataObject $dataObject, \Pimcore\Model\UserInterface $user, string $permission): array { return []; }
};
$commands = new CommandCenterService($csrf, $directory, 'test', $history, $security);
$provider = new class implements CommandPreviewProviderInterface {
    public array $lastTokens = [];
    public function command(): string { return 'test:preview'; }
    public function preview(array $tokens): CommandPreviewResult {
        $this->lastTokens = $tokens;
        return new CommandPreviewResult(42, [['label' => '/test/one', 'before' => 'old', 'after' => 'New']]);
    }
};
$service = new CommandTemplateService($storage, $commands, [$provider]);
$check = static function (bool $condition, string $message): void {
    if (!$condition) { throw new RuntimeException($message); }
};
$reject = static function (callable $action, string $class) use ($check): void {
    try { $action(); } catch (Throwable $exception) {
        $check($exception instanceof $class, 'Unexpected rejection: ' . $exception::class . ': ' . $exception->getMessage());
        return;
    }
    throw new RuntimeException('Invalid request was accepted');
};
$remove = static function (string $path) use (&$remove): void {
    if (is_dir($path)) {
        foreach (array_diff(scandir($path), ['.', '..']) as $child) { $remove($path . '/' . $child); }
        rmdir($path);
    } else { unlink($path); }
};
try {
    // Verify application providers are autoconfigured without an explicit tag.
    $container = new \Symfony\Component\DependencyInjection\ContainerBuilder();
    (new \Watza\CommandCenterBundle\DependencyInjection\PimcoreCommandCenterExtension())->load([], $container);
    foreach (array_keys($container->getDefinitions()) as $definitionId) {
        if ($definitionId !== 'service_container') {
            $container->removeDefinition($definitionId);
        }
    }
    foreach (array_keys($container->getAliases()) as $aliasId) {
        $container->removeAlias($aliasId);
    }
    $container->register('preview-test', $provider::class)->setAutoconfigured(true)->setPublic(true);
    $container->compile();
    $check($container->getDefinition('preview-test')->hasTag('command_center.preview_provider'),
        'Application preview providers were not autoconfigured');
    $fields = [
        ['name' => 'folder', 'label' => 'Folder', 'type' => 'string', 'required' => true],
        ['name' => 'limit', 'label' => 'Limit', 'type' => 'integer', 'default' => '10'],
        ['name' => 'mode', 'label' => 'Mode', 'type' => 'choice', 'choices' => ['a', 'b'], 'default' => 'a'],
    ];
    $args = ['{{folder}}', '--limit={{limit}}', '--mode={{mode}}'];
    $reject(fn () => $service->save(new TemplateSaveParameters('invalid', 'Example', 'test:preview')), AccessDeniedHttpException::class);
    $item = $service->save(new TemplateSaveParameters($token, 'Example', 'test:preview', tokens: $args, fields: $fields));
    $check($service->list()['items'][0]['previewSupported'], 'Registered preview not detected');
    $action = new TemplateActionParameters($token, $item['id'], $item['revision'], ['folder' => '/test; $(no-shell)']);
    $preview = $service->preview($action);
    $check($preview['count'] === 42 && !file_exists($directory . '/executed'), 'Preview executed the command');
    $check($provider->lastTokens === ['/test; $(no-shell)', '--limit=10', '--mode=a'], 'Field substitution/defaults changed');
    foreach ([[], ['folder' => '--env=prod'], ['folder' => 'x', 'limit' => '1.5'], ['folder' => 'x', 'mode' => 'c'],
        ['folder' => 'x', 'unknown' => 'y'], ['folder' => 'x', 'limit' => []]] as $values) {
        $reject(fn () => $service->preview(new TemplateActionParameters($token, $item['id'], 1, $values)), BadRequestHttpException::class);
    }
    foreach ([['{{unknown}}'], ['{{folder}'], [123], ['--env=prod']] as $invalid) {
        $reject(fn () => $service->save(new TemplateSaveParameters($token, 'Invalid', 'test:preview', tokens: $invalid, fields: $fields)), BadRequestHttpException::class);
    }
    $response = $service->run($action);
    $events = '';
    ob_start(static function (string $chunk) use (&$events): string { $events .= $chunk; return ''; });
    $response->sendContent(); ob_end_flush();
    $check(str_contains($events, 'template-executed'), 'Template output missing');
    $executed = json_decode(file_get_contents($directory . '/executed'), true);
    $check($executed === ['test:preview', '/test; $(no-shell)', '--limit=10', '--mode=a'], 'Execution used different arguments');
    $run = $history->list(source: 'template')['items'][0];
    $check($run['actorId'] === 101 && $run['actorName'] === 'test-admin', 'Initiating user missing from history');
    $check($run['templateId'] === $item['id'] && $run['status'] === 'success', 'Template history missing');
    $updated = $service->save(new TemplateSaveParameters($token, 'Renamed', 'test:preview', tokens: $args,
        fields: $fields, id: $item['id'], revision: 1));
    $check($updated['revision'] === 2, 'Revision not updated');
    $reject(fn () => $service->run($action), ConflictHttpException::class);
    $reject(fn () => $service->delete($action), ConflictHttpException::class);
    $service->delete(new TemplateActionParameters($token, $item['id'], 2));
    $check($service->list()['items'] === [] && $history->get($run['id'])['templateLabel'] === 'Example', 'Deleting template erased history');
    $other = $service->save(new TemplateSaveParameters($token, 'Other', 'test:unsupported'));
    $check(!$service->preview(new TemplateActionParameters($token, $other['id'], 1))['supported'], 'Unsupported preview was simulated');
    $check(!$service->list()['items'][0]['previewSupported'], 'Unsupported command marked as previewable');
    echo "Command template and read-only preview checks passed.\n";
} finally { $remove($directory); }
