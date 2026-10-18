<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

use Pimcore\Bundle\StudioBackendBundle\Security\Service\SecurityServiceInterface;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Watza\CommandCenterBundle\Parameter\CommandRunParameters;
use Watza\CommandCenterBundle\Parameter\WorkflowActionParameters;
use Watza\CommandCenterBundle\Parameter\WorkflowSaveParameters;

/** @internal */
final readonly class CommandWorkflowService
{
    public function __construct(
        private PrivateJsonStorage $storage,
        private CommandCenterService $commands,
        private CommandHistoryStore $history,
        private ?SecurityServiceInterface $security = null,
    ) {
    }

    public function list(): array
    {
        $items = array_values($this->storage->read('workflows', 'catalog') ?? []);
        usort($items, static fn (array $a, array $b): int => strnatcasecmp($a['label'], $b['label']));

        return ['items' => $items];
    }

    public function snapshot(string $id, ?int $revision): array
    {
        $item = ($this->storage->read('workflows', 'catalog') ?? [])[$id]
            ?? throw new NotFoundHttpException('Workflow not found.');
        if ($revision !== $item['revision']) {
            throw new ConflictHttpException('Workflow changed. Reload before continuing.');
        }

        return $item;
    }

    public function save(WorkflowSaveParameters $parameters): array
    {
        $this->commands->verifyCsrf($parameters->csrfToken);
        if (trim($parameters->label) === '' || strlen($parameters->label) > 120
            || strlen($parameters->description) > 2000 || !array_is_list($parameters->steps)
            || count($parameters->steps) < 1 || count($parameters->steps) > 20) {
            throw new BadRequestHttpException('A workflow requires a label and 1–20 steps.');
        }
        $steps = [];
        foreach ($parameters->steps as $step) {
            if (!is_array($step) || array_diff(array_keys($step), ['label', 'command', 'tokens', 'phpCode'])
                || !is_string($step['label'] ?? null) || trim($step['label']) === '' || strlen($step['label']) > 120
                || !is_string($step['command'] ?? null) || !is_array($step['tokens'] ?? null)
                || !array_is_list($step['tokens']) || count($step['tokens']) > 100
                || (isset($step['phpCode']) && !is_string($step['phpCode']))) {
                throw new BadRequestHttpException('Invalid workflow step.');
            }
            foreach ($step['tokens'] as $token) {
                if (!is_string($token) || strlen($token) > 8192) {
                    throw new BadRequestHttpException('Step arguments must be strings.');
                }
            }
            $run = new CommandRunParameters($step['command'], tokens: $step['tokens'], phpCode: $step['phpCode'] ?? null);
            $this->commands->validate($run);
            $steps[] = ['label' => trim($step['label']), 'command' => $run->command,
                'tokens' => $run->tokens, 'phpCode' => $run->phpCode];
        }
        if (strlen(json_encode($steps, JSON_THROW_ON_ERROR)) > 2000000) {
            throw new BadRequestHttpException('Workflow steps exceed the 2 MB limit.');
        }

        return $this->storage->transaction('workflows', 'catalog', function (?array &$items) use ($parameters, $steps): array {
            $items ??= [];
            $old = $parameters->id === null ? null : $this->snapshot($parameters->id, $parameters->revision);
            if ($old === null && count($items) >= 100) {
                throw new BadRequestHttpException('Maximum of 100 workflows reached.');
            }
            $id = $old['id'] ?? bin2hex(random_bytes(16));
            return $items[$id] = ['id' => $id, 'revision' => ($old['revision'] ?? 0) + 1,
                'label' => trim($parameters->label), 'description' => trim($parameters->description), 'steps' => $steps,
                'createdAt' => $old['createdAt'] ?? gmdate(DATE_ATOM), 'updatedAt' => gmdate(DATE_ATOM)];
        });
    }

    public function delete(WorkflowActionParameters $parameters): void
    {
        $this->commands->verifyCsrf($parameters->csrfToken);
        $this->storage->transaction('workflows', 'catalog', function (?array &$items) use ($parameters): void {
            $this->snapshot($parameters->id, $parameters->revision);
            unset($items[$parameters->id]);
        });
    }

    public function queue(WorkflowActionParameters $parameters): array
    {
        $this->commands->verifyCsrf($parameters->csrfToken);
        $workflow = $this->snapshot($parameters->id, $parameters->revision);
        $user = $this->security?->getCurrentUser();
        return $this->storage->transaction('workflow-queue', 'jobs', function (?array &$jobs) use ($workflow, $user): array {
            $jobs ??= [];
            if (count($jobs) >= 100) {
                throw new BadRequestHttpException('Maximum of 100 queued workflows reached.');
            }
            $id = $this->history->start(new CommandRunParameters('workflow'), [
                'source' => 'workflow', 'workflowId' => $workflow['id'], 'workflowLabel' => $workflow['label'],
                'actorId' => $user?->getId(), 'actorName' => $user?->getName(),
                'workflowSteps' => array_map(static fn (array $step): array => $step + ['status' => 'pending'], $workflow['steps']),
            ], 'queued');
            $jobs[$id] = ['id' => $id, 'workflow' => $workflow, 'status' => 'queued'];

            return ['id' => $id, 'status' => 'queued'];
        });
    }
}
