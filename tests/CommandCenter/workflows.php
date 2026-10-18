<?php
declare(strict_types=1);

require dirname(__DIR__) . '/bootstrap.php';

use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\Security\Csrf\CsrfTokenManager;
use Watza\CommandCenterBundle\Parameter\CommandRunParameters;
use Watza\CommandCenterBundle\Parameter\WorkflowActionParameters;
use Watza\CommandCenterBundle\Parameter\WorkflowSaveParameters;
use Watza\CommandCenterBundle\Service\CommandCenterService;
use Watza\CommandCenterBundle\Service\CommandHistoryStore;
use Watza\CommandCenterBundle\Service\CommandWorkflowService;
use Watza\CommandCenterBundle\Service\CommandWorkflowRunner;
use Watza\CommandCenterBundle\Service\PrivateJsonStorage;

session_save_path(sys_get_temp_dir());
$directory = sys_get_temp_dir() . '/command-workflows-' . bin2hex(random_bytes(8));
mkdir($directory . '/bin', 0700, true);
file_put_contents($directory . '/bin/console', <<<'PHP'
<?php
$name = $argv[4];
if ($name === 'list') { echo json_encode(['commands' => [['name' => 'test:step'], ['name' => 'pimcore:run-script']]]); exit; }
if ($name === 'pimcore:run-script') { include $argv[5]; exit; }
file_put_contents(__DIR__ . '/../executions', $argv[5] . "\n", FILE_APPEND);
echo $argv[5];
exit(($argv[5] ?? '') === 'fail' ? 7 : 0);
PHP);
$csrf = new CsrfTokenManager();
$token = $csrf->getToken('command-center')->getValue();
$storage = new PrivateJsonStorage($directory . '/data');
$history = new CommandHistoryStore($storage);
$commands = new CommandCenterService($csrf, $directory, 'test', $history);
$workflows = new CommandWorkflowService($storage, $commands, $history);
$runner = new CommandWorkflowRunner($storage, $commands, $history);
$check = static function (bool $condition, string $message): void {
    if (!$condition) { throw new RuntimeException($message); }
};
$reject = static function (callable $action, string $class) use ($check): void {
    try { $action(); } catch (Throwable $error) {
        $check($error instanceof $class, 'Wrong rejection: ' . $error::class . ': ' . $error->getMessage()); return;
    }
    throw new RuntimeException('Invalid workflow request accepted');
};
$step = static fn (string $name): array => ['label' => $name, 'command' => 'test:step', 'tokens' => [$name], 'phpCode' => null];
$remove = static function (string $path) use (&$remove): void {
    if (is_dir($path)) {
        foreach (array_diff(scandir($path), ['.', '..']) as $child) { $remove($path . '/' . $child); }
        rmdir($path);
    } else { unlink($path); }
};
try {
    $reject(fn () => $workflows->save(new WorkflowSaveParameters('invalid', 'Test', steps: [$step('one')])), AccessDeniedHttpException::class);
    foreach ([[], array_fill(0, 21, $step('x')), [['label' => 'x', 'command' => 'missing', 'tokens' => []]],
        [['label' => 'x', 'command' => 'test:step', 'tokens' => ['--env=prod']]],
        [['label' => 'x', 'command' => 'test:step', 'tokens' => [1]]]] as $invalid) {
        $reject(fn () => $workflows->save(new WorkflowSaveParameters($token, 'Invalid', steps: $invalid)), BadRequestHttpException::class);
    }
    $workflow = $workflows->save(new WorkflowSaveParameters($token, 'Original', steps: [$step('one'), $step('two')]));
    $queued = $workflows->queue(new WorkflowActionParameters($token, $workflow['id'], 1));
    $check($history->get($queued['id'])['status'] === 'queued' && !file_exists($directory . '/executions'), 'Queue ran synchronously');
    $workflows->save(new WorkflowSaveParameters($token, 'Edited', steps: [$step('different')], id: $workflow['id'], revision: 1));
    $reject(fn () => $workflows->queue(new WorkflowActionParameters($token, $workflow['id'], 1)), ConflictHttpException::class);
    $runner->tickQueued();
    $record = $history->get($queued['id']);
    $check($record['status'] === 'success' && $record['workflowLabel'] === 'Original', 'Queued snapshot changed with definition');
    $check(file_get_contents($directory . '/executions') === "one\ntwo\n", 'Steps did not execute exactly once in order');
    $check(array_column($record['workflowSteps'], 'status') === ['success', 'success'], 'Step states missing');
    foreach ($record['workflowSteps'] as $index => $result) {
        $child = $history->get($result['historyId']);
        $check($child['parentRunId'] === $record['id'] && $child['stepIndex'] === $index
            && $child['source'] === 'workflow' && $child['status'] === 'success', 'Step history missing workflow link');
    }
    $check($storage->read('workflow-queue', 'jobs') === [], 'Completed queue entry retained');
    $runner->tickQueued();
    $check(file_get_contents($directory . '/executions') === "one\ntwo\n", 'Completed workflow was replayed');
    $failed = $workflows->save(new WorkflowSaveParameters($token, 'Stop on failure', steps: [$step('before'), $step('fail'), $step('never')]));
    $job = $workflows->queue(new WorkflowActionParameters($token, $failed['id'], 1));
    $runner->tickQueued();
    $record = $history->get($job['id']);
    $check($record['status'] === 'failed' && $record['exitCode'] === 7, 'Failure exit code lost');
    $check(array_column($record['workflowSteps'], 'status') === ['success', 'failed', 'skipped'], 'Failed workflow continued');
    $check(!str_contains(file_get_contents($directory . '/executions'), 'never'), 'Skipped step executed');
    $script = $workflows->save(new WorkflowSaveParameters($token, 'PHP exception', steps: [
        ['label' => 'Script', 'command' => 'pimcore:run-script', 'tokens' => [], 'phpCode' => 'throw new RuntimeException("script-failed");'],
        $step('never'),
    ]));
    $job = $workflows->queue(new WorkflowActionParameters($token, $script['id'], 1));
    $runner->tickQueued();
    $check($history->get($job['id'])['status'] === 'failed', 'PHP failure did not fail workflow');
    $job = $workflows->queue(new WorkflowActionParameters($token, $failed['id'], 1));
    $history->begin($job['id']);
    $record = $history->get($job['id']);
    $record['workflowSteps'][0]['status'] = 'running';
    $childId = $history->start(new CommandRunParameters('test:step'), ['parentRunId' => $job['id']]);
    $record['workflowSteps'][0]['historyId'] = $childId;
    $history->workflowSteps($job['id'], $record['workflowSteps']);
    $storage->transaction('workflow-queue', 'jobs', static function (?array &$jobs) use ($job): void { $jobs[$job['id']]['status'] = 'running'; });
    $before = file_get_contents($directory . '/executions');
    $runner->tickQueued();
    $record = $history->get($job['id']);
    $check($record['status'] === 'interrupted' && array_column($record['workflowSteps'], 'status') === ['interrupted', 'skipped', 'skipped'], 'Interrupted workflow not recovered');
    $check($history->get($childId)['status'] === 'interrupted' && file_get_contents($directory . '/executions') === $before, 'Interrupted step was replayed');
    $workflows->delete(new WorkflowActionParameters($token, $failed['id'], 1));
    $check($history->get($job['id'])['workflowLabel'] === 'Stop on failure', 'Deletion erased history');
    $scheduleStore = new \Watza\CommandCenterBundle\Service\CommandScheduleStore($directory . '/schedules');
    $notifier = new class implements \Watza\CommandCenterBundle\Service\FailureNotifierInterface {
        public int $calls = 0;
        public function notify(array $schedule): array { $this->calls++; return []; }
    };
    $scheduler = new \Watza\CommandCenterBundle\Service\CommandScheduleRunner($scheduleStore, $commands, $notifier, $runner);
    $due = ['id' => bin2hex(random_bytes(16)), 'label' => 'Scheduled workflow', 'command' => 'test:step',
        'tokens' => [], 'phpCode' => null, 'workflow' => $failed, 'repeat' => 'once', 'timezone' => 'UTC',
        'nextRunAt' => gmdate(DATE_ATOM, time() - 1), 'enabled' => true, 'lastRun' => null];
    $scheduleStore->update(static function (array &$items) use ($due): void { $items[$due['id']] = $due; });
    $scheduler->tick();
    $saved = $scheduleStore->all()[0];
    $check($saved['lastRun']['status'] === 'failed' && $notifier->calls === 1, 'Scheduled workflow failure did not notify');
    $parent = $history->get($saved['lastRun']['historyId']);
    $check($parent['scheduleId'] === $due['id'] && $parent['source'] === 'scheduled'
        && array_column($parent['workflowSteps'], 'status') === ['success', 'failed', 'skipped'], 'Scheduled history/stop behavior missing');
    $check(!str_contains(file_get_contents($directory . '/executions'), 'never'), 'Scheduled workflow executed a skipped step');
    $job = $workflows->queue(new WorkflowActionParameters($token, $workflow['id'], 2));
    $lock = fopen($scheduleStore->directory() . '/runner.lock', 'c');
    flock($lock, LOCK_EX);
    $scheduler->tick();
    $check($history->get($job['id'])['status'] === 'queued', 'Worker lock did not prevent duplicate workflow execution');
    flock($lock, LOCK_UN); fclose($lock);
    $scheduler->tick();
    $check($history->get($job['id'])['status'] === 'success', 'Idle scheduler did not consume workflow queue');
    $field = ['name' => 'target', 'label' => 'Target', 'type' => 'integer', 'required' => true];
    $parameterized = $workflows->save(new WorkflowSaveParameters($token, 'Inputs', steps: [
        ['label' => 'Resolved', 'command' => 'test:step', 'tokens' => ['{{target}}']],
    ], fields: [$field]));
    $reject(fn () => $workflows->queue(new WorkflowActionParameters($token, $parameterized['id'], 1)),
        BadRequestHttpException::class);
    $reject(fn () => $workflows->resolve($parameterized['id'], 1, ['target' => 'abc']), BadRequestHttpException::class);
    $reject(fn () => $workflows->resolve($parameterized['id'], 1, ['target' => '1', 'unknown' => 'x']),
        BadRequestHttpException::class);
    $security = new class implements \Pimcore\Bundle\StudioBackendBundle\Security\Service\SecurityServiceInterface {
        public function getCurrentUser(): \Pimcore\Model\UserInterface {
            $user = new \Pimcore\Model\User(); $user->setId(1); $user->setAdmin(true); return $user;
        }
        public function isLoggedIn(): bool { return true; }
        public function hasElementPermission(\Pimcore\Model\Element\ElementInterface $e, \Pimcore\Model\UserInterface $u, string $p): void {}
        public function hasElementPermissions(\Pimcore\Model\Element\ElementInterface $e, \Pimcore\Model\UserInterface $u, array $p): void {}
        public function getSpecialDataObjectPermissions(\Pimcore\Model\DataObject $o, \Pimcore\Model\UserInterface $u, string $p): array { return []; }
    };
    $scheduleService = new \Watza\CommandCenterBundle\Service\CommandScheduleService(
        $scheduleStore, $commands, $csrf, $security,
        new \Watza\CommandCenterBundle\Service\ScheduleRecipientService(), $workflows,
    );
    $schedule = $scheduleService->create(new \Watza\CommandCenterBundle\Parameter\CommandScheduleParameters(
        new CommandRunParameters('test:step', $token), 'Parameterized schedule', '2035-01-01T12:00:00Z',
        workflow: ['id' => $parameterized['id'], 'revision' => 1, 'values' => ['target' => '42']],
    ));
    $check($schedule['workflow']['steps'][0]['tokens'] === ['42']
        && $schedule['workflow']['values'] === ['target' => '42'], 'Schedule did not freeze resolved inputs.');
    $workflows->save(new WorkflowSaveParameters($token, 'Changed inputs', steps: [$step('different')],
        id: $parameterized['id'], revision: 1));
    $check($scheduleStore->all()[1]['workflow']['steps'][0]['tokens'] === ['42'], 'Definition changed schedule snapshot.');
    $legacy = $workflows->save(new WorkflowSaveParameters($token, 'Literal braces', steps: [$step('{{literal}}')]));
    $check($workflows->resolve($legacy['id'], 1)['steps'][0]['tokens'] === ['{{literal}}'],
        'Existing workflow arguments changed without input fields.');
    echo "Workflow queue, ordering, failure-stop, snapshots, scheduling and interruption checks passed.\n";
} finally { $remove($directory); }
