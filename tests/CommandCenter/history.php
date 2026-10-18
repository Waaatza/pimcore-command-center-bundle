<?php
declare(strict_types=1);

require dirname(__DIR__) . '/bootstrap.php';

use Symfony\Component\Security\Csrf\CsrfTokenManager;
use Watza\CommandCenterBundle\Parameter\CommandRunParameters;
use Watza\CommandCenterBundle\Service\CommandCenterService;
use Watza\CommandCenterBundle\Service\CommandHistoryStore;
use Watza\CommandCenterBundle\Service\PrivateJsonStorage;

$directory = sys_get_temp_dir() . '/command-history-' . bin2hex(random_bytes(8));
mkdir($directory . '/bin', 0700, true);
file_put_contents($directory . '/bin/console', <<<'PHP'
<?php
$name = $argv[4];
if ($name === 'list') { echo json_encode(['commands' => [['name' => 'test:run']]]); exit; }
if (($argv[5] ?? '') === 'large') { echo str_repeat('x', 1100000); exit; }
echo 'stdout'; fwrite(STDERR, 'stderr'); exit((int) ($argv[5] ?? 0));
PHP);
$storage = new PrivateJsonStorage($directory . '/data');
$history = new CommandHistoryStore($storage);
$commands = new CommandCenterService(new CsrfTokenManager(), $directory, 'test', $history);
$check = static function (bool $condition, string $message): void {
    if (!$condition) { throw new RuntimeException($message); }
};
$remove = static function (string $path) use (&$remove): void {
    if (is_dir($path)) {
        foreach (array_diff(scandir($path), ['.', '..']) as $child) { $remove($path . '/' . $child); }
        rmdir($path);
    } else { unlink($path); }
};
try {
    foreach ([['0', 'success'], ['7', 'failed'], ['large', 'success']] as [$argument, $status]) {
        $id = null;
        $commands->execute(new CommandRunParameters('test:run', 'secret-csrf', [$argument]),
            static function (array $event) use (&$id): void { if ($event['type'] === 'run') { $id = $event['id']; } },
            ['source' => 'scheduled', 'scheduleId' => 'deleted-schedule', 'scheduleLabel' => 'Original label']);
        $record = (new CommandHistoryStore($storage))->get($id);
        $check($record['status'] === $status && $record['finishedAt'] !== null && $record['durationMs'] >= 0,
            'Completion metadata was not persisted');
        $check($record['tokens'] === [$argument] && $record['scheduleLabel'] === 'Original label', 'Snapshot missing');
        $check(!str_contains(json_encode($record), 'secret-csrf'), 'CSRF token leaked into history');
        if ($argument === 'large') {
            $check($record['outputTruncated'] && strlen($record['output']) === 1000000, 'Output cap failed');
        } else {
            $check(str_contains($record['output'], 'stdout') && str_contains($record['output'], 'stderr'), 'Output missing');
            $check($record['exitCode'] === (int) $argument, 'Exit code missing');
        }
    }
    $commands->execute(new CommandRunParameters('missing'), static function (): void {});
    $check($history->list(status: 'failed')['total'] === 2, 'Failed validation run missing');
    $check($history->list(source: 'scheduled', search: 'Original')['total'] === 3, 'History filtering failed');
    $id = $history->start(new CommandRunParameters('test:run'), ['source' => 'manual']);
    $record = $storage->read('history', $id);
    $record['startedTimestamp'] -= 601;
    $record['updatedTimestamp'] -= 601;
    $storage->write('history', $id, $record);
    $check($history->get($id)['status'] === 'interrupted', 'Abandoned run remained running');
    for ($i = 0; $i < 26; $i++) {
        $id = $history->start(new CommandRunParameters('test:run'), []);
        $history->finish($id, 'success', 0, '', false, null);
    }
    $check(count($history->list()['items']) === 25 && count($history->list(2)['items']) === 6, 'Pagination failed');
    $commands->execute(new CommandRunParameters('test:run'), static function (array $event): void {
        if ($event['type'] === 'out') { throw new RuntimeException('Client disconnected.'); }
    });
    $check($history->list(status: 'interrupted')['total'] === 2, 'Disconnected run not finalized');
    echo "Persistent history checks passed.\n";
} finally {
    $remove($directory);
}
