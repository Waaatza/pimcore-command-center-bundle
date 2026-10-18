<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

use Pimcore\Bundle\StaticResolverBundle\Models\Element\ServiceResolverInterface;
use Pimcore\Bundle\StaticResolverBundle\Models\User\UserResolverInterface;
use Pimcore\Bundle\StudioBackendBundle\Security\Service\SecurityServiceInterface;
use Pimcore\Model\DataObject\Concrete;
use Pimcore\Model\User;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/** @internal */
final readonly class StudioActionAccess
{
    public function __construct(
        private PrivateJsonStorage $storage,
        private SecurityServiceInterface $security,
        private ServiceResolverInterface $elements,
        private UserResolverInterface $users,
    ) {
    }

    public function user(bool $admin = false): User
    {
        $user = $this->security->getCurrentUser();
        if (!$user instanceof User || !$user->isActive() || ($admin && !$user->isAdmin())) {
            throw new AccessDeniedHttpException('Access denied.');
        }

        return $user;
    }

    public function catalog(): array
    {
        return $this->storage->read('studio-actions', 'catalog') ?? [];
    }

    public function load(string $id, ?User $user = null): array
    {
        $user ??= $this->user();
        $action = $this->catalog()[$id] ?? null;
        $roles = array_map('intval', $user->getRoles());
        if (!$user->isActive() || $action === null || !$action['enabled']
            || (!$user->isAdmin() && !in_array($user->getId(), $action['userIds'], true)
                && array_intersect($roles, $action['roleIds']) === [])) {
            throw new NotFoundHttpException('Action unavailable.');
        }

        return $action;
    }

    public function context(array $action, string $placement, ?array $context, ?User $user = null): array
    {
        $user ??= $this->user();
        if (!in_array($placement, $action['placements'], true)) {
            throw new NotFoundHttpException('Action unavailable.');
        }
        if ($placement === 'global') {
            if ($context !== null) throw new NotFoundHttpException('Invalid action context.');

            return [];
        }
        if (!in_array($placement, ['object', 'asset', 'document'], true) || $context === null
            || array_diff(array_keys($context), ['type', 'id']) || ($context['type'] ?? null) !== $placement
            || !is_int($context['id'] ?? null) || $context['id'] < 1) {
            throw new NotFoundHttpException('Invalid action context.');
        }
        $element = $this->elements->getElementById($placement, $context['id']);
        if ($element === null) throw new NotFoundHttpException('Element unavailable.');
        $this->security->hasElementPermission($element, $user, 'view');
        if ($action['elementPermission'] === 'write') {
            $this->security->hasElementPermission($element, $user, 'save');
        }
        if ($placement === 'object' && $action['objectClasses'] !== []
            && (!$element instanceof Concrete
                || !in_array((string) $element->getClassId(), $action['objectClasses'], true))) {
            throw new NotFoundHttpException('Action unavailable for this class.');
        }

        return ['id' => (string) $element->getId(), 'type' => $placement, 'path' => $element->getFullPath()];
    }

    public function verifyQueued(array $job): void
    {
        $context = $job['context'] ?? [];
        if (!isset($context['actionId'])) return;
        $user = $this->users->getById($context['actorId']);
        if (!$user instanceof User || !$user->isActive()) {
            throw new AccessDeniedHttpException('Action authorization revoked.');
        }
        $action = $this->load($context['actionId'], $user);
        if ($action['revision'] !== $context['actionRevision']) {
            throw new AccessDeniedHttpException('Action changed before execution.');
        }
        $this->context($action, $context['actionPlacement'], $context['actionContext'], $user);
    }
}
