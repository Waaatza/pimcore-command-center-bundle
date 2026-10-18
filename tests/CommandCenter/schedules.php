<?php
declare(strict_types=1);

// Run with: php tests/CommandCenter/schedules.php
require dirname(__DIR__) . '/bootstrap.php';

use Watza\CommandCenterBundle\Service\CommandCenterService;
use Watza\CommandCenterBundle\Service\CommandScheduleRunner;
use Watza\CommandCenterBundle\Service\CommandScheduleStore;
use Watza\CommandCenterBundle\Service\FailureNotifierInterface;
use Symfony\Component\Security\Csrf\CsrfTokenManager;

$directory = sys_get_temp_dir() . '/command-schedules-' . bin2hex(random_bytes(8));
mkdir($directory . '/bin', 0700, true);
file_put_contents($directory . '/bin/console', <<<'CONSOLE'
<?php
$argv = [$argv[0], ...array_slice($argv, 4)];
if ($argv[1] === 'list') {
    echo json_encode(['commands' => [['name' => 'test:scheduled'], ['name' => 'test:failure']]]);
    exit;
}
file_put_contents(dirname(__DIR__) . '/executions', $argv[1] . "\n", FILE_APPEND);
echo 'scheduled-output';
exit($argv[1] === 'test:failure' ? 9 : 0);
CONSOLE);
$store = new CommandScheduleStore($directory . '/storage');
$commands = new CommandCenterService(new CsrfTokenManager(), $directory, 'test');
$notifier = new class implements FailureNotifierInterface {
    public array $calls = [];
    public function notify(array $schedule): array
    {
        $this->calls[] = $schedule;
        if ($schedule['id'] === 'failed') {
            throw new RuntimeException('Test mail transport unavailable');
        }

        return [['userId' => 1, 'channel' => 'studio', 'status' => 'sent']];
    }
};
$runner = new CommandScheduleRunner($store, $commands, $notifier);
$check = static function (bool $condition, string $message): void {
    if (!$condition) {
        throw new RuntimeException($message);
    }
};
$make = static fn (string $id, string $repeat = 'once'): array => [
    'id' => $id, 'label' => $id, 'command' => 'test:scheduled', 'tokens' => [], 'phpCode' => null,
    'repeat' => $repeat, 'timezone' => 'Europe/Berlin',
    'nextRunAt' => (new DateTimeImmutable('-2 minutes'))->format(DATE_ATOM), 'enabled' => true, 'lastRun' => null,
];
try {
    $once = $make('once');
    $future = $make('future');
    $future['nextRunAt'] = (new DateTimeImmutable('+1 day'))->format(DATE_ATOM);
    $disabled = $make('disabled');
    $disabled['enabled'] = false;
    $store->update(static function (array &$items) use ($once, $future, $disabled): void {
        $items = ['once' => $once, 'future' => $future, 'disabled' => $disabled];
    });
    $runner->tick();
    $runner->tick();
    $check(file_get_contents($directory . '/executions') === "test:scheduled\n", 'One-time job executed twice');
    $all = array_column($store->all(), null, 'id');
    $check(!$all['once']['enabled'] && $all['once']['nextRunAt'] === null, 'One-time job not completed');
    $check($all['once']['lastRun']['status'] === 'success', 'Successful job status missing');
    $check($all['once']['lastRun']['output'] === 'scheduled-output', 'Scheduled output missing');
    $check($all['future']['lastRun'] === null && $all['disabled']['lastRun'] === null, 'Inactive job executed');
    $check(session_status() === PHP_SESSION_NONE, 'Background runner unexpectedly opened an HTTP session');

    $check($notifier->calls === [], 'Successful or skipped runs triggered notifications');

    $recurring = $make('recurring', 'daily');
    $store->update(static function (array &$items) use ($recurring): void { $items['recurring'] = $recurring; });
    $runner->tick();
    $all = array_column($store->all(), null, 'id');
    $check(new DateTimeImmutable($all['recurring']['nextRunAt']) > new DateTimeImmutable(), 'Recurrence not advanced');
    $check($all['recurring']['enabled'], 'Recurring job disabled after execution');
    $count = file_get_contents($directory . '/executions');
    $runner->tick();
    $check(file_get_contents($directory . '/executions') === $count, 'Recurrence ran twice');

    $failed = $make('failed');
    $failed['command'] = 'test:failure';
    $store->update(static function (array &$items) use ($failed): void { $items['failed'] = $failed; });
    $runner->tick();
    $all = array_column($store->all(), null, 'id');
    $check($all['failed']['lastRun']['status'] === 'failed' && $all['failed']['lastRun']['exitCode'] === 9,
        'Non-zero exit code not recorded');

    $check(count($notifier->calls) === 1, 'Failed run did not trigger exactly one notification');
    $check($all['failed']['lastRun']['notifications'][0]['status'] === 'failed', 'Notification failure not recorded');

    $interrupted = $make('interrupted', 'hourly');
    $interrupted['lastRun'] = ['status' => 'running', 'output' => 'partial'];
    $store->update(static function (array &$items) use ($interrupted): void { $items['interrupted'] = $interrupted; });
    $runner->tick();
    $all = array_column($store->all(), null, 'id');
    $check(!$all['interrupted']['enabled'] && $all['interrupted']['lastRun']['status'] === 'interrupted',
        'Interrupted job was not disabled');

    $check(count($notifier->calls) === 2, 'Interrupted run did not trigger a notification');
    $runner->tick();
    $check(count($notifier->calls) === 2, 'Interrupted run triggered repeated notifications');

    $locked = $make('locked');
    $store->update(static function (array &$items) use ($locked): void { $items['locked'] = $locked; });
    $lock = fopen($store->directory() . '/runner.lock', 'c');
    flock($lock, LOCK_EX);
    $runner->tick();
    flock($lock, LOCK_UN);
    fclose($lock);
    $all = array_column($store->all(), null, 'id');
    $check($all['locked']['lastRun'] === null, 'Concurrent runner bypassed lock');

    $due = new DateTimeImmutable('2026-10-24T08:00:00+02:00');
    $next = CommandScheduleRunner::nextRun($due, 'daily', 'Europe/Berlin', $due);
    $check($next === '2026-10-25T07:00:00+00:00', 'Daily schedule shifted local hour at DST boundary');
    $next = CommandScheduleRunner::nextRun($due, 'daily', 'Europe/Berlin', new DateTimeImmutable('2026-10-27T12:00:00Z'));
    $check($next === '2026-10-28T07:00:00+00:00', 'Missed recurrences not coalesced');
    echo "Command schedule checks passed.\n";
} finally {
    foreach (glob($directory . '/storage/*') ?: [] as $path) {
        unlink($path);
    }
    if (is_dir($directory . '/storage')) {
        rmdir($directory . '/storage');
    }
    if (is_file($directory . '/executions')) {
        unlink($directory . '/executions');
    }
    unlink($directory . '/bin/console');
    rmdir($directory . '/bin');
    rmdir($directory);
}
