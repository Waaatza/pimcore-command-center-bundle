<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

use Watza\CommandCenterBundle\Parameter\CommandRunParameters;

/** @internal */
final readonly class CommandRunWorker
{
    public function __construct(
        private PrivateJsonStorage $storage,
        private CommandCenterService $commands,
        private CommandHistoryStore $history,
        private ?StudioActionAccess $actions = null,
    ) {
    }

    /** Called under the scheduler's runner.lock. Never replay an interrupted run. */
    public function tickQueued(): void
    {
        $job = $this->storage->transaction('run-queue', 'jobs', function (?array &$jobs): ?array {
            $jobs ??= [];
            foreach ($jobs as $id => $job) {
                if ($job['status'] === 'running') {
                    $this->interrupt($id);
                    unset($jobs[$id]);
                }
            }
            foreach ($jobs as $id => $job) {
                $jobs[$id]['status'] = 'running';
                return $job;
            }
            return null;
        });
        if ($job === null) {
            return;
        }
        try {
            if (isset($job['context']['actionId'])) {
                if ($this->actions === null) throw new \RuntimeException('Action authorization unavailable.');
                $this->actions->verifyQueued($job);
            }
            $this->commands->executeQueued($job['id'], new CommandRunParameters(
                $job['command'], tokens: $job['tokens'], phpCode: $job['phpCode'],
            ), $job['context']);
        } catch (\Throwable $error) {
            $this->interrupt($job['id']);
            $this->history->finish($job['id'], 'failed', null, '', false, $error->getMessage());
        } finally {
            $this->storage->transaction('run-queue', 'jobs', static function (?array &$jobs) use ($job): void {
                unset($jobs[$job['id']]);
            });
        }
    }

    private function interrupt(string $id): void
    {
        $record = $this->history->get($id);
        if (!in_array($record['status'], ['running', 'queued', 'interrupted'], true)) {
            return;
        }
        $this->history->finish($id, 'interrupted', null, $record['output'], $record['outputTruncated'],
            'Worker interrupted. Execution will not resume automatically.');
    }
}
