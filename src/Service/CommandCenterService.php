<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\Process\PhpExecutableFinder;
use Symfony\Component\Process\Process;
use Symfony\Component\Security\Csrf\CsrfToken;
use Symfony\Component\Security\Csrf\CsrfTokenManagerInterface;
use Watza\CommandCenterBundle\Parameter\CommandRunParameters;

/** @internal */
final readonly class CommandCenterService
{
    public function __construct(
        private CsrfTokenManagerInterface $csrfTokenManager,
        #[Autowire('%kernel.project_dir%')]
        private string $projectDir,
        #[Autowire('%kernel.environment%')]
        private string $environment,
    ) {
    }

    public function catalog(): array
    {
        $catalog = $this->definitions();
        $catalog['csrfToken'] = $this->csrfTokenManager->getToken('command-center')->getValue();

        return $catalog;
    }

    public function definitions(): array
    {
        $process = $this->process(['list', '--format=json']);
        $process->setTimeout(30);
        $process->mustRun();

        return json_decode($process->getOutput(), true, 512, JSON_THROW_ON_ERROR);
    }

    public function run(CommandRunParameters $parameters): StreamedResponse
    {
        if (!$this->csrfTokenManager->isTokenValid(new CsrfToken('command-center', $parameters->csrfToken))) {
            throw new AccessDeniedHttpException('Invalid CSRF token. Reload the Command Center.');
        }
        $this->validate($parameters);

        return new StreamedResponse(function () use ($parameters): void {
            set_time_limit(330);
            $emit = static function (array $event): void {
                echo json_encode($event, JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR) . "\n";
                if (ob_get_level() > 0) {
                    ob_flush();
                }
                flush();
            };
            $this->executeValidated($parameters, static function (array $event) use ($emit): void {
                $emit($event);
                if (connection_aborted()) {
                    throw new \RuntimeException('Client disconnected.');
                }
            });
        }, 200, [
            'Content-Type' => 'application/x-ndjson',
            'Cache-Control' => 'no-cache, no-store',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    public function validate(CommandRunParameters $parameters): void
    {
        $names = array_column($this->definitions()['commands'], 'name');
        if (!in_array($parameters->command, $names, true)) {
            throw new BadRequestHttpException('Unknown command.');
        }
        foreach ($parameters->tokens as $token) {
            if (!is_string($token) || str_contains($token, "\0")) {
                throw new BadRequestHttpException('Invalid argument.');
            }
            // Environment, interaction and output format are controlled by the server.
            if (preg_match('/^(--(env|ansi|no-ansi|no-interaction|interaction)(=|$)|-[en])/', $token)) {
                throw new BadRequestHttpException('This global option is controlled by the server.');
            }
        }
        if ($parameters->phpCode !== null) {
            if ($parameters->command !== 'pimcore:run-script' || trim($parameters->phpCode) === ''
                || strlen($parameters->phpCode) > 1000000) {
                throw new BadRequestHttpException(
                    'PHP code requires pimcore:run-script and must contain 1–1000000 bytes.',
                );
            }
            foreach ($parameters->tokens as $token) {
                if (!in_array(
                    $token, ['--dry-run', '--verbose', '-v', '-vv', '-vvv', '--quiet', '-q'], true,
                )) {
                    throw new BadRequestHttpException('Inline scripts only support dry-run, verbose and quiet options.');
                }
            }
        }
    }

    /** Execute without an HTTP session, for server-side scheduled jobs. */
    public function execute(CommandRunParameters $parameters, callable $emit): void
    {
        $this->validate($parameters);
        $this->executeValidated($parameters, $emit);
    }

    private function executeValidated(CommandRunParameters $parameters, callable $emit): void
    {
        $process = null;
        $scriptDirectory = null;
        $scriptPath = null;
        try {
            $tokens = $parameters->tokens;
            if ($parameters->phpCode !== null) {
                $scriptDirectory = sys_get_temp_dir() . '/studio-script-' . bin2hex(random_bytes(16));
                if (!mkdir($scriptDirectory, 0700)) {
                    throw new \RuntimeException('Could not create temporary script directory.');
                }
                $scriptPath = $scriptDirectory . '/script.php';
                $code = ltrim($parameters->phpCode);
                if (!preg_match('/^<\?(php\s|=)/i', $code)) {
                    $code = "<?php\n" . $code;
                }
                if (file_put_contents($scriptPath, $code) !== strlen($code)) {
                    throw new \RuntimeException('Could not write temporary PHP script.');
                }
                array_unshift($tokens, $scriptPath);
            }
            $process = $this->process([$parameters->command, ...$tokens]);
            $process->start();
            foreach ($process as $type => $chunk) {
                $emit(['type' => $type, 'text' => $chunk]);
            }
            $emit(['type' => 'exit', 'code' => $process->getExitCode()]);
        } catch (\Throwable $exception) {
            $emit(['type' => 'error', 'text' => $exception->getMessage()]);
        } finally {
            if ($process !== null && $process->isRunning()) {
                $process->stop();
            }
            if ($scriptPath !== null && is_file($scriptPath)) {
                unlink($scriptPath);
            }
            if ($scriptDirectory !== null && is_dir($scriptDirectory)) {
                rmdir($scriptDirectory);
            }
        }
    }

    private function process(array $tokens): Process
    {
        $php = (new PhpExecutableFinder())->find(false);
        if ($php === false) {
            throw new \RuntimeException('PHP CLI executable not found.');
        }

        return new Process(
            [$php, $this->projectDir . '/bin/console',
                '--env=' . $this->environment, '--no-interaction', '--no-ansi', ...$tokens],
            $this->projectDir,
            timeout: 300,
        );
    }
}
