<?php
declare(strict_types=1);

require dirname(__DIR__) . '/bootstrap.php';

use Pimcore\Bundle\StaticResolverBundle\Contract\Models\Element\ServiceResolverContract;
use Pimcore\Bundle\StaticResolverBundle\Contract\Models\User\Role\RoleResolverContract;
use Pimcore\Bundle\StaticResolverBundle\Contract\Models\User\UserResolverContract;
use Pimcore\Bundle\StaticResolverBundle\Models\Element\ServiceResolverInterface;
use Pimcore\Bundle\StaticResolverBundle\Models\User\Role\RoleResolverInterface;
use Pimcore\Bundle\StaticResolverBundle\Models\User\UserResolverInterface;
use Pimcore\Bundle\StudioBackendBundle\Security\Service\SecurityServiceInterface;
use Pimcore\Model\Asset;
use Pimcore\Model\DataObject;
use Pimcore\Model\DataObject\AbstractObject;
use Pimcore\Model\DataObject\Concrete;
use Pimcore\Model\Document;
use Pimcore\Model\Element\ElementInterface;
use Pimcore\Model\User;
use Pimcore\Model\UserInterface;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Security\Csrf\CsrfTokenManager;
use Watza\CommandCenterBundle\Parameter\CommandRunParameters;
use Watza\CommandCenterBundle\Parameter\StudioActionRequest;
use Watza\CommandCenterBundle\Parameter\StudioActionSaveParameters;
use Watza\CommandCenterBundle\Parameter\TemplateActionParameters;
use Watza\CommandCenterBundle\Parameter\TemplateSaveParameters;
use Watza\CommandCenterBundle\Parameter\WorkflowActionParameters;
use Watza\CommandCenterBundle\Parameter\WorkflowSaveParameters;
use Watza\CommandCenterBundle\Service\CommandCenterService;
use Watza\CommandCenterBundle\Service\CommandHistoryStore;
use Watza\CommandCenterBundle\Service\CommandInputResolver;
use Watza\CommandCenterBundle\Service\CommandRunQueue;
use Watza\CommandCenterBundle\Service\CommandRunWorker;
use Watza\CommandCenterBundle\Service\CommandTemplateService;
use Watza\CommandCenterBundle\Service\CommandWorkflowRunner;
use Watza\CommandCenterBundle\Service\CommandWorkflowService;
use Watza\CommandCenterBundle\Service\PrivateJsonStorage;
use Watza\CommandCenterBundle\Service\StudioActionAccess;
use Watza\CommandCenterBundle\Service\StudioActionReconciler;
use Watza\CommandCenterBundle\Service\StudioActionService;

session_save_path(sys_get_temp_dir());
$directory = sys_get_temp_dir() . '/studio-actions-' . bin2hex(random_bytes(8));
mkdir($directory . '/bin', 0700, true);
file_put_contents($directory . '/bin/console', <<<'PHP'
<?php
if ($argv[4] === 'list') {
    echo json_encode(['commands' => [['name' => 'test:echo'], ['name' => 'pimcore:run-script']]]); exit;
}
file_put_contents(__DIR__ . '/../executed', json_encode([
    'tokens' => array_slice($argv, 5), 'inputs' => json_decode(getenv('COMMAND_CENTER_INPUTS') ?: '{}', true),
]) . "\n", FILE_APPEND);
if ($argv[4] === 'pimcore:run-script') { include $argv[5]; exit; }
echo "secret-output\n";
PHP);
$makeUser = static function (int $id, bool $admin = false): User {
    $user = new User(); $user->setId($id); $user->setName('user-' . $id);
    $user->setActive(true); $user->setAdmin($admin);
    return $user;
};
$admin = $makeUser(1, true); $editor = $makeUser(2); $other = $makeUser(3);
$security = new class ($admin) implements SecurityServiceInterface {
    public bool $view = true;
    public bool $write = true;
    public function __construct(public User $current) {}
    public function getCurrentUser(): UserInterface { return $this->current; }
    public function isLoggedIn(): bool { return true; }
    public function hasElementPermission(ElementInterface $element, UserInterface $user, string $permission): void
    {
        if (!$user->isAdmin() && (($permission === 'view' && !$this->view) || ($permission === 'save' && !$this->write))) {
            throw new AccessDeniedHttpException('Element permission denied.');
        }
    }
    public function hasElementPermissions(ElementInterface $element, UserInterface $user, array $permissions): void {}
    public function getSpecialDataObjectPermissions(DataObject $object, UserInterface $user, string $permission): array
    {
        return [];
    }
};
$users = new class ([$admin, $editor, $other]) extends UserResolverContract implements UserResolverInterface {
    public function __construct(public array $items) {}
    public function getById(int $id): ?User
    {
        foreach ($this->items as $item) if ($item->getId() === $id) return $item;
        return null;
    }
    public function getUserRoleById(int $id): ?User\UserRole { return null; }
    public function createUserRole(array $values = []): User\UserRole { throw new LogicException(); }
    public function getUserRoleByName(string $name): ?User\UserRole { return null; }
};
$roles = new class extends RoleResolverContract implements RoleResolverInterface {
    public function getById(int $id): ?User\Role
    {
        if ($id !== 77) return null;
        $role = new User\Role(); $role->setId(77); return $role;
    }
};
$object = new class extends Concrete {
    public function getFullPath(): string { return '/products/' . $this->getId(); }
};
$object->setId(11); $object->setClassId('Product');
$asset = new class extends Asset {
    public function getFullPath(): string { return '/assets/' . $this->getId(); }
};
$asset->setId(12);
$document = new class extends Document {
    public function getFullPath(bool $force = false): string { return '/documents/' . $this->getId(); }
};
$document->setId(13);
$elements = new class (['object' => $object, 'asset' => $asset, 'document' => $document])
    extends ServiceResolverContract implements ServiceResolverInterface {
    public function __construct(public array $items) {}
    public function getElementById(string $type, int|string $id, array $params = []): Asset|Document|AbstractObject|null
    {
        $item = $this->items[$type] ?? null;
        return $item?->getId() === $id ? $item : null;
    }
    public function findForbiddenPaths(string $type, User $user): array { return []; }
    public function isPublished(?ElementInterface $element = null): bool { return true; }
    public function escapeCsvRecord(array $rowData): array { return $rowData; }
    public function unEscapeCsvRecord(array $rowData): array { return $rowData; }
};
$csrf = new CsrfTokenManager(); $token = $csrf->getToken('command-center')->getValue();
$storage = new PrivateJsonStorage($directory . '/data');
$history = new CommandHistoryStore($storage);
$queue = new CommandRunQueue($storage, $history);
$commands = new CommandCenterService($csrf, $directory, 'test', $history, $security, $queue);
$inputs = new CommandInputResolver();
$reconciler = new StudioActionReconciler($storage);
$templates = new CommandTemplateService($storage, $commands, $reconciler);
$workflows = new CommandWorkflowService($storage, $commands, $history, $reconciler, $security);
$access = new StudioActionAccess($storage, $security, $elements, $users);
$service = new StudioActionService($storage, $access, $commands, $templates, $workflows, $history, $inputs,
    $csrf, $users, $roles);
$runner = new CommandWorkflowRunner($storage, $commands, $history, $access);
$runWorker = new CommandRunWorker($storage, $commands, $history, $access);
$check = static function (bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); };
$reject = static function (callable $call, string $type): void {
    try { $call(); } catch (Throwable $error) { if ($error instanceof $type) return; throw $error; }
    throw new RuntimeException('Unsafe request accepted.');
};
$remove = static function (string $path) use (&$remove): void {
    if (is_dir($path)) {
        foreach (array_diff(scandir($path), ['.', '..']) as $child) $remove($path . '/' . $child);
        rmdir($path);
    } else unlink($path);
};
try {
    $field = ['name' => 'target', 'label' => 'Target', 'type' => 'string', 'required' => true];
    $template = $templates->save(new TemplateSaveParameters($token, 'Template', 'test:echo',
        tokens: ['{{target}}'], fields: [$field]));
    $save = static fn (array $overrides = []): array => $service->save(new StudioActionSaveParameters(...[
        'csrfToken' => $token, 'label' => 'Approved', 'enabled' => true,
        'targetId' => $template['id'], 'placements' => ['global'], 'userIds' => [2], ...$overrides,
    ]));
    $request = static fn (array $action, array $overrides = []): StudioActionRequest => new StudioActionRequest(...[
        'csrfToken' => $token, 'id' => $action['id'], 'revision' => $action['revision'],
        'targetRevision' => 1, ...$overrides,
    ]);
    $default = $service->save(new StudioActionSaveParameters($token, label: 'Disabled', targetId: $template['id'],
        placements: ['global']));
    $check(!$default['enabled'] && $default['userIds'] === [] && $default['roleIds'] === [], 'Unsafe defaults.');
    $reject(fn () => $save(['csrfToken' => 'bad']), AccessDeniedHttpException::class);
    $reject(fn () => $save(['placements' => ['global'], 'bindings' => ['target' => ['source' => 'id']]]),
        BadRequestHttpException::class);
    $reject(fn () => $save(['direct' => true]), BadRequestHttpException::class);
    $reject(fn () => $save(['roleIds' => [999]]), BadRequestHttpException::class);
    $reject(fn () => $save(['userIds' => ['2']]), BadRequestHttpException::class);
    $check($default['iconType'] === 'name' && $default['icon'] === 'play', 'Legacy icon default changed.');
    foreach (['/bundles/example/icon.svg', 'https://example.com/icon.svg'] as $path) {
        $customIcon = $save(['iconType' => 'path', 'icon' => $path]);
        $check($customIcon['icon'] === $path && $customIcon['iconType'] === 'path', 'Custom icon not persisted.');
        $check($service->prepare($request($customIcon))['iconType'] === 'path', 'Icon type missing in metadata.');
        $service->delete($request($customIcon));
    }
    foreach (['javascript:alert(1)', 'data:image/svg+xml,test', '//example.com/icon.svg', '/bad path.svg', "/bad\0.svg"] as $path) {
        $reject(fn () => $save(['iconType' => 'path', 'icon' => $path]), BadRequestHttpException::class);
    }
    $reject(fn () => $save(['iconType' => 'other']), BadRequestHttpException::class);
    $reject(fn () => $save(['icon' => '/bundles/example/icon.svg']), BadRequestHttpException::class);
    $reject(fn () => $save(['iconType' => 'path', 'icon' => '/' . str_repeat('a', 2048)]), BadRequestHttpException::class);
    $action = $save();
    $security->current = $editor;
    $reject($save, AccessDeniedHttpException::class);
    $reject(fn () => $service->delete($request($action)), AccessDeniedHttpException::class);
    $available = $service->available(new StudioActionRequest());
    $check(count($available['items']) === 1, 'User grants or disabled state wrong.');
    $check(!isset($available['items'][0]['targetId'], $available['items'][0]['bindings']), 'Definition exposed.');
    $prepared = $service->prepare($request($action));
    $check(count($prepared['fields']) === 1 && !isset($prepared['command']), 'Unsafe prepared action.');
    $reject(fn () => $service->run($request($action, ['csrfToken' => 'bad'])), AccessDeniedHttpException::class);
    $reject(fn () => $service->run($request($action, ['targetRevision' => 2])), ConflictHttpException::class);
    $reject(fn () => $service->run($request($action, ['values' => []])), BadRequestHttpException::class);
    $reject(fn () => $service->run($request($action, ['values' => ['target' => '--env=prod']])),
        BadRequestHttpException::class);
    $queued = $service->run($request($action, ['values' => ['target' => '/safe; $(literal)']]));
    $runWorker->tickQueued();
    $id = $queued['id'];
    $safe = $service->result(new StudioActionRequest(runId: $id));
    $check($safe['status'] === 'success' && !isset($safe['output'], $safe['error'], $safe['tokens']), 'Result leaked.');
    $executed = json_decode(trim(file_get_contents($directory . '/executed')), true);
    $check($executed['tokens'] === ['/safe; $(literal)'] && $executed['inputs']['target'] === '/safe; $(literal)',
        'Resolved arguments or JSON environment changed.');
    $security->current = $other;
    $check($service->available(new StudioActionRequest())['items'] === [], 'Other user saw private action.');
    $reject(fn () => $service->result(new StudioActionRequest(runId: $id)), NotFoundHttpException::class);
    $reject(fn () => $service->run($request($action, ['values' => ['target' => 'x']])), NotFoundHttpException::class);
    $security->current = $admin;
    $roleAction = $save(['userIds' => [], 'roleIds' => [77], 'bindings' => ['target' => ['source' => 'fixed', 'value' => 'fixed-secret']]]);
    $security->current = $editor; $editor->setRoles([77]);
    $check(count($service->available(new StudioActionRequest())['items']) === 2, 'Role grant missing.');
    $check($service->prepare($request($roleAction))['fields'] === [], 'Fixed value editable.');
    $reject(fn () => $service->run($request($roleAction, ['values' => ['target' => 'override']])),
        BadRequestHttpException::class);
    $editor->setRoles([]);
    $reject(fn () => $service->prepare($request($roleAction)), NotFoundHttpException::class);
    $security->current = $admin;
    foreach (['object' => $object, 'asset' => $asset, 'document' => $document] as $type => $element) {
        $bound = $save(['placements' => [$type], 'objectClasses' => $type === 'object' ? ['Product'] : [],
            'bindings' => ['target' => ['source' => 'id']]]);
        $context = ['type' => $type, 'id' => $element->getId()];
        $args = ['placement' => $type, 'context' => $context];
        $security->current = $editor;
        $check($service->prepare($request($bound, $args))['bound'][0]['value'] === (string) $element->getId(),
            'Bound element ID missing.');
        $reject(fn () => $service->run($request($bound, $args + ['values' => ['target' => '999']])) ,
            BadRequestHttpException::class);
        $reject(fn () => $service->prepare($request($bound, ['placement' => $type,
            'context' => $context + ['path' => '/forged']])) , NotFoundHttpException::class);
        $security->write = false;
        $reject(fn () => $service->prepare($request($bound, $args)), AccessDeniedHttpException::class);
        $security->current = $admin;
        $read = $save(['id' => $bound['id'], 'revision' => $bound['revision'], 'placements' => [$type],
            'elementPermission' => 'read', 'bindings' => ['target' => ['source' => 'path']]]);
        $security->current = $editor;
        $check($service->prepare($request($read, $args))['bound'][0]['value'] === $element->getFullPath(),
            'Read-only action required save permission or used browser path.');
        $security->view = true; $security->current = $admin;
        $redacted = $save(['placements' => [$type], 'objectClasses' => $type === 'object' ? ['Product'] : [],
            'elementPermission' => 'read', 'bindings' => ['target' => ['source' => 'id']], 'showOutput' => false]);
        $security->current = $editor;
        $redactedRun = $service->run($request($redacted, $args))['id'];
        $runWorker->tickQueued();
        $check($service->result(new StudioActionRequest(runId: $redactedRun))['status'] === 'success',
            'Editor lost the result of a visible element.');
        $security->view = false;
        $reject(fn () => $service->prepare($request($read, $args)), AccessDeniedHttpException::class);
        $reject(fn () => $service->result(new StudioActionRequest(runId: $redactedRun)),
            AccessDeniedHttpException::class);
        $security->view = true; $security->write = true; $security->current = $admin;
    }
    $wrongClass = $save(['placements' => ['object'], 'objectClasses' => ['Other']]);
    $security->current = $editor;
    $reject(fn () => $service->prepare($request($wrongClass,
        ['placement' => 'object', 'context' => ['type' => 'object', 'id' => 11]])), NotFoundHttpException::class);
    $editor->setActive(false);
    $reject(fn () => $service->available(new StudioActionRequest()), AccessDeniedHttpException::class);
    $editor->setActive(true); $security->current = $admin;

    $workflow = $workflows->save(new WorkflowSaveParameters($token, 'Inputs', steps: [
        ['label' => 'Token', 'command' => 'test:echo', 'tokens' => ['{{target}}']],
        ['label' => 'PHP', 'command' => 'pimcore:run-script', 'tokens' => [],
            'phpCode' => 'echo "input=" . json_decode(getenv("COMMAND_CENTER_INPUTS"), true)["target"];'],
    ], fields: [$field]));
    $workflowAction = $save(['targetType' => 'workflow', 'targetId' => $workflow['id'], 'showOutput' => true]);
    $security->current = $editor;
    $queued = $service->run($request($workflowAction, ['values' => ['target' => 'snapshot']]));
    $security->current = $admin;
    $workflows->save(new WorkflowSaveParameters($token, 'Edited', steps: [
        ['label' => 'Changed', 'command' => 'test:echo', 'tokens' => ['different']],
    ], id: $workflow['id'], revision: 1));
    $runner->tickQueued();
    $security->current = $editor;
    $run = $service->result(new StudioActionRequest(runId: $queued['id']));
    $check($run['status'] === 'success' && str_contains($run['output'], 'input=snapshot'),
        'Workflow inputs/snapshot/output missing.');
    $check($history->get($queued['id'])['inputValues'] === ['target' => 'snapshot'], 'Input snapshot not recorded.');
    $unrelated = $history->start(new CommandRunParameters('test:echo'), ['actorId' => 2]);
    $reject(fn () => $service->result(new StudioActionRequest(runId: $unrelated)), NotFoundHttpException::class);
    $security->current = $admin;
    $queuedAction = $save(['targetType' => 'workflow', 'targetId' => $workflow['id']]);
    $security->current = $editor;
    $queued = $service->run($request($queuedAction, ['targetRevision' => 2]));
    $before = file_get_contents($directory . '/executed');
    $editor->setActive(false);
    $runner->tickQueued();
    $check($history->get($queued['id'])['status'] === 'failed'
        && file_get_contents($directory . '/executed') === $before, 'Revoked user executed queued workflow.');
    $editor->setActive(true);
    $security->current = $admin;
    $roleQueue = $save(['targetType' => 'workflow', 'targetId' => $workflow['id'],
        'userIds' => [], 'roleIds' => [77]]);
    $editor->setRoles([77]); $security->current = $editor;
    $queued = $service->run($request($roleQueue, ['targetRevision' => 2]));
    $editor->setRoles([]);
    $runner->tickQueued();
    $check($history->get($queued['id'])['status'] === 'failed'
        && file_get_contents($directory . '/executed') === $before, 'Revoked role executed queued workflow.');
    $security->current = $admin;
    $contextQueue = $save(['targetType' => 'workflow', 'targetId' => $workflow['id'], 'placements' => ['object']]);
    $security->current = $editor;
    $queued = $service->run($request($contextQueue, ['targetRevision' => 2, 'placement' => 'object',
        'context' => ['type' => 'object', 'id' => 11]]));
    $security->write = false;
    $runner->tickQueued();
    $check($history->get($queued['id'])['status'] === 'failed'
        && file_get_contents($directory . '/executed') === $before, 'Revoked element access executed workflow.');
    $security->write = true;
    $security->current = $admin;
    $queued = $service->run($request($contextQueue, ['targetRevision' => 2, 'placement' => 'object',
        'context' => ['type' => 'object', 'id' => 11]]));
    $save(['id' => $contextQueue['id'], 'revision' => $contextQueue['revision'],
        'targetType' => 'workflow', 'targetId' => $workflow['id'], 'enabled' => false]);
    $runner->tickQueued();
    $check($history->get($queued['id'])['status'] === 'failed'
        && file_get_contents($directory . '/executed') === $before, 'Disabled action executed queued workflow.');
    $updated = $save(['id' => $action['id'], 'revision' => $action['revision']]);
    $reject(fn () => $save(['id' => $action['id'], 'revision' => $action['revision']]), ConflictHttpException::class);
    $security->current = $editor;
    $reject(fn () => $service->prepare($request($action)), ConflictHttpException::class);
    $security->current = $admin;
    $service->delete($request($updated));

    $orphanTemplate = $templates->save(new TemplateSaveParameters($token, 'Orphan', 'test:echo'));
    $orphan = $save(['targetId' => $orphanTemplate['id'], 'enabled' => true]);
    $valid = $save(['targetId' => $template['id'], 'enabled' => true]);
    $templates->delete(new TemplateActionParameters($token, $orphanTemplate['id'], $orphanTemplate['revision']));
    $catalog = $access->catalog();
    $check(!$catalog[$orphan['id']]['enabled'] && $catalog[$orphan['id']]['revision'] === $orphan['revision'] + 1,
        'Deleting a template did not deactivate its action.');
    $check($catalog[$valid['id']]['enabled'] === true, 'Deleting a template disabled an unrelated action.');
    $orphanWorkflow = $workflows->save(new WorkflowSaveParameters($token, 'Orphan', steps: [
        ['label' => 'Noop', 'command' => 'test:echo', 'tokens' => []],
    ]));
    $workflowOrphan = $save(['targetType' => 'workflow', 'targetId' => $orphanWorkflow['id'], 'enabled' => true]);
    $workflows->delete(new WorkflowActionParameters($token, $orphanWorkflow['id'], $orphanWorkflow['revision']));
    $check($access->catalog()[$workflowOrphan['id']]['enabled'] === false,
        'Deleting a workflow did not deactivate its action.');
} finally { $remove($directory); }
echo "Studio action grants, contexts, revisions, output isolation and queued authorization checks passed.\n";
