<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

use Pimcore\Bundle\StaticResolverBundle\Models\User\Role\RoleResolverInterface;
use Pimcore\Bundle\StaticResolverBundle\Models\User\UserResolverInterface;
use Pimcore\Model\DataObject\ClassDefinition\Listing as ClassListing;
use Pimcore\Model\User;
use Pimcore\Model\User\Role\Listing as RoleListing;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Security\Csrf\CsrfTokenManagerInterface;
use Watza\CommandCenterBundle\Parameter\StudioActionRequest;
use Watza\CommandCenterBundle\Parameter\StudioActionSaveParameters;
use Watza\CommandCenterBundle\Parameter\TemplateActionParameters;

/** @internal */
final readonly class StudioActionService
{
    public function __construct(
        private PrivateJsonStorage $storage,
        private StudioActionAccess $access,
        private CommandCenterService $commands,
        private CommandTemplateService $templates,
        private CommandWorkflowService $workflows,
        private CommandHistoryStore $history,
        private CommandInputResolver $inputs,
        private CsrfTokenManagerInterface $csrf,
        private UserResolverInterface $users,
        private RoleResolverInterface $roles,
    ) {
    }

    public function adminList(): array
    {
        $this->access->user(true);
        $users = new User\Listing();
        $users->setCondition('active = ?', [1]);
        $roles = new RoleListing();
        $classes = new ClassListing();
        $option = static fn ($item): array => ['value' => $item->getId(), 'label' => $item->getName()];

        return [
            'items' => array_values($this->access->catalog()),
            'templates' => $this->templates->list()['items'], 'workflows' => $this->workflows->list()['items'],
            'users' => array_map($option, $users->load()), 'roles' => array_map($option, $roles->load()),
            'classes' => array_map(static fn ($item): array => [
                'value' => (string) $item->getId(), 'label' => $item->getName(),
            ], $classes->load()),
            'csrfToken' => $this->csrf->getToken('command-center')->getValue(),
        ];
    }

    public function save(StudioActionSaveParameters $parameters): array
    {
        $this->access->user(true);
        $this->commands->verifyCsrf($parameters->csrfToken);
        $action = get_object_vars($parameters);
        unset($action['csrfToken'], $action['id'], $action['revision']);
        $target = $this->target($action);
        foreach ($parameters->placements as $placement) {
            if (!is_string($placement)) throw new BadRequestHttpException('Invalid placement.');
        }
        if (trim($parameters->label) === '' || strlen($parameters->label) > 120
            || !in_array($parameters->iconType, ['name', 'path'], true)
            || strlen($parameters->icon) > 2048
            || !preg_match($parameters->iconType === 'path'
                ? '~^(?:/(?!/)|https?://)[^\s<>"\x00-\x1f]+$~D'
                : '/^[a-zA-Z0-9_-]{1,80}$/D', $parameters->icon)
            || !in_array($parameters->elementPermission, ['read', 'write'], true)
            || !array_is_list($parameters->placements) || $parameters->placements === []
            || count($parameters->placements) > 4
            || array_diff($parameters->placements, ['global', 'object', 'asset', 'document'])
            || count($parameters->bindings) > 30
            || array_diff(array_keys($parameters->bindings), array_column($target['fields'] ?? [], 'name'))) {
            throw new BadRequestHttpException('Invalid studio action.');
        }
        foreach (['userIds', 'roleIds'] as $key) {
            if (!array_is_list($action[$key]) || count($action[$key]) > 100) {
                throw new BadRequestHttpException('Invalid action grants.');
            }
            foreach ($action[$key] as $id) {
                if (!is_int($id) || $id < 1 || ($key === 'userIds'
                    ? !($this->users->getById($id)?->isActive() ?? false) : $this->roles->getById($id) === null)) {
                    throw new BadRequestHttpException('Invalid action user or role.');
                }
            }
        }
        if (!array_is_list($parameters->objectClasses) || count($parameters->objectClasses) > 100) {
            throw new BadRequestHttpException('Invalid object classes.');
        }
        foreach ($parameters->objectClasses as $class) {
            if (!is_string($class) || !preg_match('/^[a-zA-Z0-9_-]{1,80}$/D', $class)) {
                throw new BadRequestHttpException('Invalid object class.');
            }
        }
        foreach ($parameters->bindings as $binding) {
            if (!is_array($binding) || array_diff(array_keys($binding), ['source', 'value'])
                || !in_array($binding['source'] ?? null, ['input', 'fixed', 'id', 'path', 'type'], true)
                || (isset($binding['value']) && (!is_string($binding['value']) || strlen($binding['value']) > 4096
                    || str_contains($binding['value'], "\0")))
                || (in_array('global', $parameters->placements, true)
                    && in_array($binding['source'], ['id', 'path', 'type'], true))) {
                throw new BadRequestHttpException('Invalid input binding or global element context.');
            }
        }
        foreach ($target['fields'] ?? [] as $field) {
            $binding = $parameters->bindings[$field['name']] ?? ['source' => 'input'];
            if ($binding['source'] === 'fixed') {
                $this->inputs->values([$field], [$field['name'] => $binding['value'] ?? '']);
            } elseif ($parameters->direct && $binding['source'] === 'input') {
                $this->inputs->values([$field], []);
            }
        }

        return $this->storage->transaction('studio-actions', 'catalog', function (?array &$items) use (
            $parameters, $action,
        ): array {
            $items ??= [];
            $old = $parameters->id === null ? null : ($items[$parameters->id]
                ?? throw new NotFoundHttpException('Action not found.'));
            if ($old !== null && $old['revision'] !== $parameters->revision) {
                throw new ConflictHttpException('Action changed. Reload before continuing.');
            }
            if ($old === null && count($items) >= 100) {
                throw new BadRequestHttpException('Maximum of 100 studio actions reached.');
            }
            $id = $old['id'] ?? bin2hex(random_bytes(16));
            $items[$id] = $action + ['id' => $id, 'revision' => ($old['revision'] ?? 0) + 1];

            return $items[$id];
        });
    }

    public function delete(StudioActionRequest $request): void
    {
        $this->access->user(true);
        $this->commands->verifyCsrf($request->csrfToken);
        $this->storage->transaction('studio-actions', 'catalog', static function (?array &$items) use ($request): void {
            $old = $items[$request->id] ?? throw new NotFoundHttpException('Action not found.');
            if ($old['revision'] !== $request->revision) throw new ConflictHttpException('Action changed.');
            unset($items[$request->id]);
        });
    }

    public function available(StudioActionRequest $request): array
    {
        $this->access->user();
        $items = [];
        foreach ($this->access->catalog() as $id => $unused) {
            try {
                $action = $this->access->load($id);
                $this->access->context($action, $request->placement, $request->context);
                $target = $this->target($action);
                $items[] = $this->metadata($action, $target);
            } catch (HttpExceptionInterface $error) {
                if (!in_array($error->getStatusCode(), [403, 404], true)) throw $error;
            }
        }
        usort($items, static fn (array $a, array $b): int => ($a['position'] <=> $b['position'])
            ?: strnatcasecmp($a['label'], $b['label']));

        return ['items' => $items, 'csrfToken' => $this->csrf->getToken('command-center')->getValue()];
    }

    public function prepare(StudioActionRequest $request): array
    {
        [$action, $target, $context] = $this->resolve($request);
        $fields = [];
        $bound = [];
        foreach ($target['fields'] ?? [] as $field) {
            $binding = $action['bindings'][$field['name']] ?? ['source' => 'input'];
            if ($binding['source'] === 'input') $fields[] = $field;
            elseif (isset($context[$binding['source']])) {
                $bound[] = ['label' => $field['label'], 'value' => $context[$binding['source']]];
            }
        }

        return $this->metadata($action, $target) + ['fields' => $fields, 'bound' => $bound];
    }

    public function preview(StudioActionRequest $request): array
    {
        [$action, $target, $context] = $this->resolve($request);
        $values = $this->values($action, $target, $context, $request->values);
        if ($action['targetType'] !== 'template') return ['supported' => false];

        return $this->templates->preview(new TemplateActionParameters(
            $request->csrfToken, $target['id'], $target['revision'], $values,
        ));
    }

    public function run(StudioActionRequest $request): array|StreamedResponse
    {
        [$action, $target, $element] = $this->resolve($request);
        $user = $this->access->user();
        $values = $this->values($action, $target, $element, $request->values);
        $context = [
            'actorId' => $user->getId(), 'actorName' => $user->getName(),
            'actionId' => $action['id'], 'actionRevision' => $action['revision'], 'actionLabel' => $action['label'],
            'actionPlacement' => $request->placement, 'actionContext' => $request->context,
            'showOutput' => $action['showOutput'], 'inputValues' => $values,
        ];
        if ($action['targetType'] === 'workflow') {
            $workflow = $this->workflows->resolve($target['id'], $target['revision'], $values);

            return $this->workflows->queueSnapshot($workflow, $context);
        }
        [, $run] = $this->templates->resolve(new TemplateActionParameters(
            $request->csrfToken, $target['id'], $target['revision'], $values,
        ));

        return $this->commands->run($run, $context + [
            'source' => 'template', 'templateId' => $target['id'], 'templateLabel' => $target['label'],
        ], !$action['showOutput'] && !$user->isAdmin());
    }

    public function result(StudioActionRequest $request): array
    {
        $user = $this->access->user();
        $record = $this->history->get($request->runId);
        if (!isset($record['actionId']) || (!$user->isAdmin() && $record['actorId'] !== $user->getId())) {
            throw new NotFoundHttpException('Run unavailable.');
        }
        $action = $this->access->load($record['actionId']);
        $this->access->context($action, $record['actionPlacement'], $record['actionContext']);
        $safe = array_intersect_key($record, array_flip(['id', 'status', 'exitCode', 'durationMs']));
        $safe['steps'] = array_map(static fn (array $step): array => array_intersect_key(
            $step, array_flip(['label', 'status', 'exitCode']),
        ), $record['workflowSteps'] ?? []);
        if ($user->isAdmin() || ($action['showOutput'] && $record['showOutput'])) {
            $safe['output'] = $record['output'];
        }

        return $safe;
    }

    private function target(array $action): array
    {
        if (!in_array($action['targetType'], ['template', 'workflow'], true)) {
            throw new BadRequestHttpException('Invalid action target.');
        }
        $area = $action['targetType'] === 'template' ? 'templates' : 'workflows';

        return ($this->storage->read($area, 'catalog') ?? [])[$action['targetId']]
            ?? throw new NotFoundHttpException('Action target unavailable.');
    }

    private function metadata(array $action, array $target): array
    {
        return array_intersect_key($action, array_flip([
            'id', 'revision', 'label', 'icon', 'iconType', 'position', 'direct', 'showOutput', 'targetType',
        ])) + [
            'targetRevision' => $target['revision'],
            'previewSupported' => $action['targetType'] === 'template'
                && $this->templates->hasPreview($target['command']),
        ];
    }

    private function resolve(StudioActionRequest $request): array
    {
        $this->commands->verifyCsrf($request->csrfToken);
        $action = $this->access->load($request->id);
        $context = $this->access->context($action, $request->placement, $request->context);
        $target = $this->target($action);
        if ($action['revision'] !== $request->revision || $target['revision'] !== $request->targetRevision
            || array_diff(array_keys($action['bindings']), array_column($target['fields'] ?? [], 'name'))) {
            throw new ConflictHttpException('Action or target changed. Reload before continuing.');
        }

        return [$action, $target, $context];
    }

    private function values(array $action, array $target, array $context, array $submitted): array
    {
        $values = [];
        foreach ($target['fields'] ?? [] as $field) {
            $name = $field['name'];
            $binding = $action['bindings'][$name] ?? ['source' => 'input'];
            $source = $binding['source'];
            if ($source !== 'input' && array_key_exists($name, $submitted)) {
                throw new BadRequestHttpException('Bound inputs cannot be overridden.');
            }
            $values[$name] = match ($source) {
                'input' => $submitted[$name] ?? ($field['default'] ?? ''),
                'fixed' => $binding['value'] ?? '',
                default => $context[$source] ?? throw new BadRequestHttpException('Element context required.'),
            };
        }
        if (array_diff(array_keys($submitted), array_keys($values))) {
            throw new BadRequestHttpException('Unknown action input.');
        }

        return $this->inputs->values($target['fields'] ?? [], $values);
    }
}
