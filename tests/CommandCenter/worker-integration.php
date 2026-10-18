<?php
declare(strict_types=1);

// Opt-in integration check against the running application worker. Removes its own test plan afterwards.
require dirname(__DIR__) . '/bootstrap.php';

use Watza\CommandCenterBundle\Service\CommandScheduleStore;
use Watza\CommandCenterBundle\Service\CommandHistoryStore;
use Watza\CommandCenterBundle\Service\PrivateJsonStorage;

if (!in_array('--live-worker', $argv, true)) {
    throw new RuntimeException('Run inside the application container with --live-worker.');
}
$kernel = Pimcore\Bootstrap::startupCli();
$store = new CommandScheduleStore($kernel->getProjectDir() . '/var/command-center/' . $kernel->getEnvironment());
$id = bin2hex(random_bytes(16));
$item = [
    'id' => $id, 'label' => 'Integration check (temporary)', 'command' => 'pimcore:run-script',
    'tokens' => [], 'phpCode' => "<?php echo 'scheduled-worker-ok';", 'repeat' => 'once',
    'timezone' => 'Europe/Berlin', 'nextRunAt' => gmdate(DATE_ATOM, time() + 1),
    'enabled' => true, 'createdAt' => gmdate(DATE_ATOM), 'createdBy' => null, 'lastRun' => null,
];
try {
    $store->update(static function (array &$items) use ($id, $item): void { $items[$id] = $item; });
    $deadline = time() + 45;
    $passed = false;
    do {
        usleep(250000);
        $items = array_column($store->all(), null, 'id');
        $run = $items[$id]['lastRun'] ?? null;
        if ($run !== null && $run['status'] !== 'running') {
            if ($run['status'] !== 'success' || $run['exitCode'] !== 0
                || !str_contains($run['output'], 'scheduled-worker-ok')) {
                throw new RuntimeException('Worker check failed: ' . json_encode($run));
            }
            $history = new CommandHistoryStore(new PrivateJsonStorage(
                $kernel->getProjectDir() . '/var/command-center/' . $kernel->getEnvironment(),
            ));
            $record = $history->get($run['historyId'] ?? '');
            if ($record['status'] !== 'success' || $record['scheduleId'] !== $id
                || $record['source'] !== 'scheduled' || !str_contains($record['output'], 'scheduled-worker-ok')) {
                throw new RuntimeException('Scheduled run was not retained in persistent history.');
            }
            echo "Live scheduled PHP execution passed (exit 0, output and history persisted).\n";
            $passed = true;
            break;
        }
    } while (time() < $deadline);
    if (!$passed) {
        throw new RuntimeException('Worker did not complete the scheduled job within 45 seconds.');
    }
} finally {
    $store->update(static function (array &$items) use ($id): void { unset($items[$id]); });
}
