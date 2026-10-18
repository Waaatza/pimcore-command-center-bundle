<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

use Watza\CommandCenterBundle\Parameter\CommandRunParameters;

/** @internal */
final readonly class CommandWorkflowRunner
{
    public function __construct(
        private PrivateJsonStorage $storage,
        private CommandCenterService $commands,
        private CommandHistoryStore $history,
    ) {
    }

    /** Called under the scheduler's runner.lock. Never replay an interrupted workflow. */
    public function tickQueued(): void
    {
        $job = $this->storage->transaction('workflow-queue', 'jobs', function (?array &$jobs): ?array {
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
            $this->execute($job['workflow'], static function (array $event): void {}, [], $job['id']);
        } finally {
            $this->storage->transaction('workflow-queue', 'jobs', static function (?array &$jobs) use ($job): void {
                unset($jobs[$job['id']]);
            });
        }
    }

    public function interrupt(string $id): void
    {
        $record = $this->history->get($id);
        if (!in_array($record['status'], ['running', 'queued', 'interrupted'], true)) {
            return;
        }
        $steps = $record['workflowSteps'] ?? [];
        foreach ($steps as &$step) {
            if (($step['status'] ?? '') === 'running') {
                $step['status'] = 'interrupted';
                if (isset($step['historyId'])) {
                    $child = $this->history->get($step['historyId']);
                    if ($child['status'] === 'running' || $child['status'] === 'interrupted') {
                        $this->history->finish($child['id'], 'interrupted', null, $child['output'],
                            $child['outputTruncated'], 'Workflow worker interrupted.');
                    }
                }
            } elseif (($step['status'] ?? '') === 'pending') {
                $step['status'] = 'skipped';
            }
        }
        unset($step);
        $this->history->workflowSteps($id, $steps);
        $this->history->finish($id, 'interrupted', null, $record['output'], $record['outputTruncated'],
            'Workflow worker interrupted. Remaining steps were skipped; execution will not resume automatically.');
    }

    public function execute(array $workflow, callable $emit, array $context = [], ?string $id = null): void
    {
        if ($id !== null) {
            $parent = $this->history->get($id);
            $context = array_replace(array_intersect_key($parent, array_flip(['source', 'actorId', 'actorName'])), $context);
        }
        $steps = array_map(static fn (array $step): array => $step + ['status' => 'pending'], $workflow['steps']);
        $context = array_replace($context, ['workflowId' => $workflow['id'], 'workflowLabel' => $workflow['label']]);
        $id ??= $this->history->start(new CommandRunParameters('workflow'), $context + ['workflowSteps' => $steps]);
        $this->history->begin($id);
        $output = '';
        $truncated = false;
        $code = 0;
        $error = null;
        $lastFlush = 0.0;
        $forward = function (array $event) use ($id, $emit, &$output, &$truncated, &$lastFlush): void {
            if (isset($event['text'])) {
                $output .= $event['text'];
                if (strlen($output) > 1000000) {
                    $output = substr($output, -1000000);
                    $truncated = true;
                }
            }
            if (microtime(true) - $lastFlush >= 1) {
                $this->history->progress($id, $output, $truncated);
                $lastFlush = microtime(true);
            }
            $emit($event);
        };
        try {
            $forward(['type' => 'run', 'id' => $id]);
            foreach ($steps as $index => &$step) {
                $step['status'] = 'running';
                $this->history->workflowSteps($id, $steps);
                $forward(['type' => 'out', 'text' => sprintf("\n[%d/%d] %s\n", $index + 1, count($steps), $step['label'])]);
                $stepCode = null;
                $stepError = null;
                $this->commands->execute(
                    new CommandRunParameters($step['command'], tokens: $step['tokens'], phpCode: $step['phpCode'] ?? null),
                    function (array $event) use ($forward, $id, &$steps, &$step, &$stepCode, &$stepError): void {
                        if ($event['type'] === 'run') {
                            $step['historyId'] = $event['id'];
                            $this->history->workflowSteps($id, $steps);
                        } elseif ($event['type'] === 'exit') {
                            $stepCode = $event['code'];
                        } else {
                            if ($event['type'] === 'error') {
                                $stepError = $event['text'];
                            }
                            $forward($event);
                        }
                    }, $context + ['parentRunId' => $id, 'stepIndex' => $index, 'stepLabel' => $step['label']],
                );
                $step['exitCode'] = $stepCode;
                $step['status'] = $stepCode === 0 && $stepError === null ? 'success' : 'failed';
                $this->history->workflowSteps($id, $steps);
                $this->history->progress($id, $output, $truncated);
                if ($step['status'] === 'failed') {
                    $code = $stepCode ?: 1;
                    $error = $stepError ?? 'Step failed: ' . $step['label'];
                    break;
                }
            }
            unset($step);
        } catch (\Throwable $exception) {
            $code = 1;
            $error = $exception->getMessage();
            $output = substr($output . "\n" . $error, -1000000);
        } finally {
            unset($step);
            foreach ($steps as &$remaining) {
                if ($remaining['status'] === 'pending') {
                    $remaining['status'] = 'skipped';
                } elseif ($remaining['status'] === 'running') {
                    $remaining['status'] = 'failed';
                }
            }
            unset($remaining);
            $this->history->workflowSteps($id, $steps);
            $this->history->finish($id, $code === 0 ? 'success' : 'failed', $code, $output, $truncated, $error);
        }
        $emit(['type' => 'exit', 'code' => $code]);
    }
}
