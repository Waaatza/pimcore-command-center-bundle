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
$privateStorage = new \Watza\CommandCenterBundle\Service\PrivateJsonStorage($directory . '/storage');
$workflowService = new \Watza\CommandCenterBundle\Service\CommandWorkflowService(
    $privateStorage, new CommandCenterService($csrf, $directory, 'test'),
    new \Watza\CommandCenterBundle\Service\CommandHistoryStore($privateStorage),
);
$service = new CommandScheduleService(
    $store, new CommandCenterService($csrf, $directory, 'test'), $csrf, $security, new ScheduleRecipientService(), $workflowService,
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
    $dst = $service->create(new CommandScheduleParameters(
        new CommandRunParameters('test:a', $token), 'DST', '2030-03-30T02:30:00+01:00', 'daily', 'Europe/Berlin',
    ));
    $check($dst['localTime'] === '02:30:00', 'Schedule creation did not capture the local time');
    $store->update(static function (array &$items) use ($dst): void {
        $items[$dst['id']]['nextRunAt'] = '2030-03-31T01:30:00+00:00';
    });
    $renamed = $service->update(new CommandScheduleUpdateParameters($dst['id'], new CommandScheduleParameters(
        new CommandRunParameters('test:a', $token), 'Renamed', '2030-03-31T01:30:00Z', 'daily', 'Europe/Berlin',
    ), true, 0));
    $check($renamed['localTime'] === '02:30:00', 'Unchanged execution date overwrote the original local time');
    $rescheduled = $service->update(new CommandScheduleUpdateParameters($dst['id'], new CommandScheduleParameters(
        new CommandRunParameters('test:a', $token), 'Rescheduled', '2030-04-01T04:15:00+02:00', 'daily', 'Europe/Berlin',
    ), true, 1));
    $check($rescheduled['localTime'] === '04:15:00', 'Explicit rescheduling did not update the local time');
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
    $workflow = $workflowService->save(new \Watza\CommandCenterBundle\Parameter\WorkflowSaveParameters(
        $token, 'Scheduled definition', steps: [['label' => 'First', 'command' => 'test:a', 'tokens' => []]],
    ));
    $workflowPlan = $service->create(new CommandScheduleParameters(
        new CommandRunParameters('test:a', $token), 'Workflow plan', '+1 hour',
        workflow: ['id' => $workflow['id'], 'revision' => 1],
    ));
    $workflowService->delete(new \Watza\CommandCenterBundle\Parameter\WorkflowActionParameters($token, $workflow['id'], 1));
    $updated = $service->update(new CommandScheduleUpdateParameters($workflowPlan['id'],
        new CommandScheduleParameters(new CommandRunParameters('test:b', $token), 'Edited workflow plan', '+2 hours'), true, 0,
    ));
    $check($updated['workflow'] === $workflowPlan['workflow'] && $updated['command'] === 'test:a',
        'Editing converted workflow into a single command or lost its snapshot after deletion');
    echo "Schedule editing checks passed.\n";
} finally {
    $remove = static function (string $path) use (&$remove): void {
        if (is_dir($path)) {
            foreach (array_diff(scandir($path), ['.', '..']) as $child) { $remove($path . '/' . $child); }
            rmdir($path);
        } else { unlink($path); }
    };
    if (is_dir($directory . '/storage')) { $remove($directory . '/storage'); }
    unlink($directory . '/bin/console');
    rmdir($directory . '/bin');
    rmdir($directory);
}
