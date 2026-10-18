<?php
declare(strict_types=1);

// Run with: php tests/CommandCenter/smoke.php
require dirname(__DIR__) . '/bootstrap.php';

use Watza\CommandCenterBundle\Parameter\CommandRunParameters;
use Watza\CommandCenterBundle\Service\CommandCenterService;
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
$service = new CommandCenterService($tokens, $directory, 'test');
$check = static function (bool $condition, string $message): void {
    if (!$condition) {
        throw new RuntimeException($message);
    }
};
try {
    $check($service->catalog()['commands'][0]['name'] === 'test:output', 'Catalog missing command');
    try {
        $service->run(new CommandRunParameters('test:output', 'invalid'));
        throw new RuntimeException('Invalid CSRF token accepted');
    } catch (AccessDeniedHttpException) {
    }
    foreach ([['unknown', []], ['test:output', ['--env=prod']]] as [$name, $arguments]) {
        try {
            $service->run(new CommandRunParameters($name, $token, $arguments));
            throw new RuntimeException('Invalid command or environment override accepted');
        } catch (BadRequestHttpException) {
        }
    }
    $literal = 'hello; $(echo shell-executed)';
    $response = $service->run(new CommandRunParameters('test:output', $token, [$literal]));
    $events = '';
    ob_start(static function (string $chunk) use (&$events): string {
        $events .= $chunk;
        return '';
    });
    $response->sendContent();
    ob_end_flush();
    $decoded = array_map(static fn (string $line): array => json_decode($line, true, flags: JSON_THROW_ON_ERROR),
        explode("\n", trim($events)));
    $text = implode('', array_column($decoded, 'text'));
    $check(str_contains($text, $literal), 'Arguments were changed or interpreted by a shell');
    $check(str_contains($text, 'stderr-message'), 'stderr output missing');
    $check(end($decoded) === ['type' => 'exit', 'code' => 7], 'Exit code missing');
    foreach (["echo 'inline-ok';", "<?php echo 'inline-ok';", "<?php throw new RuntimeException('script-error');"] as $code) {
        $response = $service->run(new CommandRunParameters('pimcore:run-script', $token, phpCode: $code));
        $events = '';
        ob_start(static function (string $chunk) use (&$events): string {
            $events .= $chunk;
            return '';
        });
        $response->sendContent();
        ob_end_flush();
        $decoded = array_map(static fn (string $line): array => json_decode($line, true, flags: JSON_THROW_ON_ERROR),
            explode("\n", trim($events)));
        $text = implode('', array_column($decoded, 'text'));
        $check(str_contains($text, str_contains($code, 'script-error') ? 'script-error' : 'inline-ok'),
            'Inline script output missing');
        preg_match('/SCRIPT_PATH=([^\r\n]+)/', $text, $matches);
        $check(isset($matches[1]) && !file_exists($matches[1]) && !is_dir(dirname($matches[1])),
            'Temporary script was not cleaned up');
    }
    foreach ([['test:output', [], 'echo 1;'], ['pimcore:run-script', [], ' '],
        ['pimcore:run-script', ['other.php'], 'echo 1;']] as [$name, $arguments, $code]) {
        try {
            $service->run(new CommandRunParameters($name, $token, $arguments, $code));
            throw new RuntimeException('Invalid inline script request accepted');
        } catch (BadRequestHttpException) {
        }
    }
    echo "Command Center smoke checks passed.\n";
} finally {
    unlink($directory . '/bin/console');
    rmdir($directory . '/bin');
    rmdir($directory);
}
