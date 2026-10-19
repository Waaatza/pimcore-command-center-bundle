<?php
declare(strict_types=1);

// Run with: php tests/CommandCenter/smoke.php
require dirname(__DIR__) . '/bootstrap.php';

use Watza\CommandCenterBundle\Parameter\CommandRunParameters;
use Watza\CommandCenterBundle\Service\CommandCenterService;
use Watza\CommandCenterBundle\Service\CommandHistoryStore;
use Watza\CommandCenterBundle\Service\CommandRunQueue;
use Watza\CommandCenterBundle\Service\CommandRunWorker;
use Watza\CommandCenterBundle\Service\PrivateJsonStorage;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\Security\Csrf\CsrfTokenManager;

session_save_path(sys_get_temp_dir());
$directory = sys_get_temp_dir() . '/command-center-' . bin2hex(random_bytes(8));
mkdir($directory . '/bin', 0700, true);
file_put_contents($directory . '/bin/console', <<<'CONSOLE'
<?php
$argv = [$argv[0], ...array_slice($argv, 4)];
if ($argv[1] === 'list') {
    echo json_encode(['commands' => [['name' => 'test:output'], ['name' => 'pimcore:run-script']]]);
    exit;
}
if ($argv[1] === 'pimcore:run-script') {
    fwrite(STDOUT, 'SCRIPT_PATH=' . $argv[2] . PHP_EOL);
    include $argv[2];
    exit(0);
}
fwrite(STDOUT, $argv[2]);
fwrite(STDERR, 'stderr-message');
exit(7);
CONSOLE);
$tokens = new CsrfTokenManager();
$token = $tokens->getToken('command-center')->getValue();
$storage = new PrivateJsonStorage($directory . '/data');
$history = new CommandHistoryStore($storage);
$queue = new CommandRunQueue($storage, $history);
$service = new CommandCenterService($tokens, $directory, 'test', $history, null, $queue);
$worker = new CommandRunWorker($storage, $service, $history);
$run = static function (CommandRunParameters $parameters) use ($service, $worker, $history): array {
    $queued = $service->queue($parameters);
    $worker->tickQueued();

    return $history->get($queued['id']);
};
$check = static function (bool $condition, string $message): void {
    if (!$condition) {
        throw new RuntimeException($message);
    }
};
try {
    $check($service->catalog()['commands'][0]['name'] === 'test:output', 'Catalog missing command');
    try {
        $service->queue(new CommandRunParameters('test:output', 'invalid'));
        throw new RuntimeException('Invalid CSRF token accepted');
    } catch (AccessDeniedHttpException) {
    }
    foreach ([['unknown', []], ['test:output', ['--env=prod']]] as [$name, $arguments]) {
        try {
            $service->queue(new CommandRunParameters($name, $token, $arguments));
            throw new RuntimeException('Invalid command or environment override accepted');
        } catch (BadRequestHttpException) {
        }
    }
    $literal = 'hello; $(echo shell-executed)';
    $record = $run(new CommandRunParameters('test:output', $token, [$literal]));
    $text = $record['output'];
    $check($record['status'] === 'failed' && $record['exitCode'] === 7, 'Exit code missing');
    $check(str_contains($text, $literal), 'Arguments were changed or interpreted by a shell');
    $check(str_contains($text, 'stderr-message'), 'stderr output missing');
    foreach (["echo 'inline-ok';", "<?php echo 'inline-ok';", "<?php throw new RuntimeException('script-error');"] as $code) {
        $record = $run(new CommandRunParameters('pimcore:run-script', $token, phpCode: $code));
        $text = $record['output'];
        $check(str_contains($text, str_contains($code, 'script-error') ? 'script-error' : 'inline-ok'),
            'Inline script output missing');
        preg_match('/SCRIPT_PATH=([^\r\n]+)/', $text, $matches);
        $check(isset($matches[1]) && !file_exists($matches[1]) && !is_dir(dirname($matches[1])),
            'Temporary script was not cleaned up');
    }
    foreach ([['test:output', [], 'echo 1;'], ['pimcore:run-script', [], ' '],
        ['pimcore:run-script', ['other.php'], 'echo 1;']] as [$name, $arguments, $code]) {
        try {
            $service->queue(new CommandRunParameters($name, $token, $arguments, $code));
            throw new RuntimeException('Invalid inline script request accepted');
        } catch (BadRequestHttpException) {
        }
    }
    echo "Command Center smoke checks passed.\n";
} finally {
    $remove = static function (string $path) use (&$remove): void {
        if (is_dir($path)) {
            foreach (array_diff(scandir($path), ['.', '..']) as $child) $remove($path . '/' . $child);
            rmdir($path);
        } elseif (is_file($path)) {
            unlink($path);
        }
    };
    $remove($directory);
}
