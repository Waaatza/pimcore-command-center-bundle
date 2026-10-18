<?php
declare(strict_types=1);

require dirname(__DIR__) . '/bootstrap.php';

use Pimcore\Bundle\StudioBackendBundle\Security\Service\SecurityServiceInterface;
use Pimcore\Model\DataObject;
use Pimcore\Model\Element\ElementInterface;
use Pimcore\Model\User;
use Pimcore\Model\UserInterface;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Security\Csrf\CsrfTokenManager;
use Watza\CommandCenterBundle\Parameter\CommandRunParameters;
use Watza\CommandCenterBundle\Parameter\CommandScheduleParameters;
use Watza\CommandCenterBundle\Parameter\CommandScheduleUpdateParameters;
use Watza\CommandCenterBundle\Service\CommandCenterService;
use Watza\CommandCenterBundle\Service\CommandScheduleService;
use Watza\CommandCenterBundle\Service\CommandScheduleStore;
use Watza\CommandCenterBundle\Service\ScheduleRecipientService;

session_save_path(sys_get_temp_dir());
$directory = sys_get_temp_dir() . '/command-editing-' . bin2hex(random_bytes(8));
mkdir($directory . '/bin', 0700, true);
file_put_contents($directory . '/bin/console', <<<'CONSOLE'
<?php
echo json_encode(['commands' => [['name' => 'test:a'], ['name' => 'test:b'], ['name' => 'pimcore:run-script']]]);
CONSOLE);
$security = new class implements SecurityServiceInterface {
    public function getCurrentUser(): User
    {
        $user = new User();
        $user->setId(101);
        $user->setAdmin(true);

        return $user;
    }
    public function isLoggedIn(): bool { return true; }
    public function hasElementPermission(ElementInterface $element, UserInterface $user, string $permission): void {}
    public function hasElementPermissions(ElementInterface $element, UserInterface $user, array $permissions): void {}
    public function getSpecialDataObjectPermissions(DataObject $dataObject, UserInterface $user, string $permission): array
    {
        return [];
    }
};
$csrf = new CsrfTokenManager();
$token = $csrf->getToken('command-center')->getValue();
$store = new CommandScheduleStore($directory . '/storage');
$service = new CommandScheduleService(
    $store, new CommandCenterService($csrf, $directory, 'test'), $csrf, $security, new ScheduleRecipientService(),
);
$check = static function (bool $value, string $message): void {
    if (!$value) { throw new RuntimeException($message); }
};
$expect = static function (string $type, callable $action): void {
    try { $action(); } catch (Throwable $error) {
        if ($error instanceof $type) { return; }
        throw $error;
    }
    throw new RuntimeException('Expected ' . $type);
};
try {
    $created = $service->create(new CommandScheduleParameters(
        new CommandRunParameters('test:a', $token), 'Original', '+1 hour',
    ));
    $id = $created['id'];
    $result = ['status' => 'failed', 'output' => 'preserved output', 'exitCode' => 7];
    $store->update(static function (array &$items) use ($id, $result): void { $items[$id]['lastRun'] = $result; });
    $parameters = new CommandScheduleParameters(
        new CommandRunParameters('test:b', $token, ['changed']), 'Edited', '+2 hours', 'daily',
    );
    $edited = $service->update(new CommandScheduleUpdateParameters($id, $parameters, false, 0));
    $check($edited['id'] === $id && $edited['createdAt'] === $created['createdAt']
        && $edited['createdBy'] === $created['createdBy'], 'Identity or creation metadata lost');
    $check($edited['lastRun'] === $result, 'Editing erased the previous execution result');
    $check($edited['command'] === 'test:b' && $edited['tokens'] === ['changed']
        && $edited['repeat'] === 'daily' && !$edited['enabled'], 'Editable fields not updated');
    $expect(ConflictHttpException::class, fn () => $service->update(
        new CommandScheduleUpdateParameters($id, $parameters, true, 0),
    ));
    $check($service->get($id) === $edited, 'Stale edit modified the schedule');
    $store->update(static function (array &$items) use ($id): void { $items[$id]['lastRun']['status'] = 'running'; });
    $expect(ConflictHttpException::class, fn () => $service->update(
        new CommandScheduleUpdateParameters($id, $parameters, true, 1),
    ));
    $store->update(static function (array &$items) use ($id, $result): void {
        $items[$id]['lastRun'] = $result;
        $items[$id]['nextRunAt'] = null;
    });
    $script = new CommandScheduleParameters(
        new CommandRunParameters('pimcore:run-script', $token, [], 'echo 1;'), 'Rearmed', '+1 day',
    );
    $rearmed = $service->update(new CommandScheduleUpdateParameters($id, $script, true, 1));
    $check($rearmed['enabled'] && $rearmed['phpCode'] === 'echo 1;' && $rearmed['lastRun'] === $result,
        'Completed schedule could not be rescheduled without losing its result');
    $expect(NotFoundHttpException::class, fn () => $service->update(
        new CommandScheduleUpdateParameters(str_repeat('a', 32), $parameters),
    ));
    $past = new CommandScheduleParameters(new CommandRunParameters('test:a', $token), 'Past', '-1 hour');
    $expect(BadRequestHttpException::class, fn () => $service->update(
        new CommandScheduleUpdateParameters($id, $past, true, 2),
    ));
    $invalidToken = new CommandScheduleParameters(new CommandRunParameters('test:a', 'invalid'), 'Bad token', '+1 day');
    $expect(AccessDeniedHttpException::class, fn () => $service->update(
        new CommandScheduleUpdateParameters($id, $invalidToken, true, 2),
    ));
    echo "Schedule editing checks passed.\n";
} finally {
    foreach (glob($directory . '/storage/*') ?: [] as $path) { unlink($path); }
    if (is_dir($directory . '/storage')) { rmdir($directory . '/storage'); }
    unlink($directory . '/bin/console');
    rmdir($directory . '/bin');
    rmdir($directory);
}
