<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Watza\CommandCenterBundle\Parameter\CommandRunParameters;

/** @internal */
final readonly class CommandHistoryStore
{
    public function __construct(private PrivateJsonStorage $storage)
    {
    }

    public function start(CommandRunParameters $parameters, array $context, string $status = 'running'): string
    {
        $id = sprintf('%016x', (int) (microtime(true) * 1000000)) . bin2hex(random_bytes(8));
        $record = array_replace([
            'source' => 'background', 'actorId' => null, 'actorName' => null,
            'scheduleId' => null, 'scheduleLabel' => null, 'templateId' => null, 'templateLabel' => null,
        ], array_intersect_key($context, array_flip([
            'source', 'actorId', 'actorName', 'scheduleId', 'scheduleLabel', 'templateId', 'templateLabel',
            'workflowId', 'workflowLabel', 'parentRunId', 'stepIndex', 'stepLabel', 'workflowSteps',
        ])), [
            'id' => $id, 'command' => $parameters->command, 'tokens' => $parameters->tokens,
            'phpCode' => $parameters->phpCode, 'createdAt' => gmdate(DATE_ATOM),
            'startedAt' => $status === 'queued' ? null : gmdate(DATE_ATOM),
            'startedTimestamp' => $status === 'queued' ? null : microtime(true),
            'finishedAt' => null, 'durationMs' => null, 'exitCode' => null, 'status' => $status,
            'output' => '', 'outputTruncated' => false, 'error' => null,
        ]);
        $this->save($record);

        return $id;
    }

    public function begin(string $id): void
    {
        $record = $this->get($id);
        $record['status'] = 'running';
        $record['startedAt'] = gmdate(DATE_ATOM);
        $record['startedTimestamp'] = microtime(true);
        $this->save($record);
    }

    public function workflowSteps(string $id, array $steps): void
    {
        $record = $this->get($id);
        $record['workflowSteps'] = $steps;
        $this->save($record);
    }

    public function progress(string $id, string $output, bool $truncated): void
    {
        $record = $this->get($id);
        if ($record['status'] !== 'running') {
            return;
        }
        $record['output'] = $output;
        $record['outputTruncated'] = $truncated;
        $this->save($record);
    }

    public function finish(string $id, string $status, ?int $exitCode, string $output, bool $truncated, ?string $error): void
    {
        $record = $this->get($id);
        $record = array_replace($record, [
            'status' => $status, 'exitCode' => $exitCode, 'output' => $output, 'outputTruncated' => $truncated,
            'error' => $error, 'finishedAt' => gmdate(DATE_ATOM),
            'durationMs' => (int) round((microtime(true) - ($record['startedTimestamp'] ?? microtime(true))) * 1000),
        ]);
        $this->save($record);
    }

    public function get(string $id): array
    {
        if (!preg_match('/^[a-f0-9]{32}$/D', $id)) {
            throw new NotFoundHttpException('Run not found.');
        }
        $record = $this->storage->read('history', $id) ?? throw new NotFoundHttpException('Run not found.');
        if ($record['status'] === 'running' && microtime(true) - ($record['updatedTimestamp'] ?? $record['startedTimestamp']) > 600) {
            $record['status'] = 'interrupted';
            $record['error'] = 'No completion was recorded within the maximum execution window.';
            // The actual completion time and exit code are unknown after a worker crash.
            $this->save($record);
        }

        return $record;
    }

    public function list(int $page = 1, string $status = '', string $source = '', string $search = ''): array
    {
        $files = glob($this->storage->directory('history-summary') . '/*.json') ?: [];
        rsort($files, SORT_STRING);
        $matches = [];
        foreach ($files as $file) {
            $record = json_decode(file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
            if ($record['status'] === 'running' && microtime(true) - ($record['updatedTimestamp'] ?? $record['startedTimestamp']) > 600) {
                $record = $this->summary($this->get($record['id']));
            }
            if (($status !== '' && $record['status'] !== $status)
                || ($source !== '' && $record['source'] !== $source)
                || ($search !== '' && stripos($record['command'] . ' ' . ($record['scheduleLabel'] ?? '')
                    . ' ' . ($record['templateLabel'] ?? '') . ' ' . ($record['workflowLabel'] ?? ''), $search) === false)) {
                continue;
            }
            $matches[] = $record;
        }

        return ['items' => array_slice($matches, (max(1, $page) - 1) * 25, 25), 'total' => count($matches)];
    }

    private function save(array $record): void
    {
        $record['updatedTimestamp'] = microtime(true);
        $this->storage->write('history', $record['id'], $record);
        $this->storage->write('history-summary', $record['id'], $this->summary($record));
    }

    private function summary(array $record): array
    {
        unset($record['tokens'], $record['phpCode'], $record['output'], $record['workflowSteps']);

        return $record;
    }
}
