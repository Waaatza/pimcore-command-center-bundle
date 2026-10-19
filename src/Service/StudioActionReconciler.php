<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

/** @internal */
final readonly class StudioActionReconciler
{
    public function __construct(
        private PrivateJsonStorage $storage,
    ) {
    }

    public function deactivateTarget(string $targetType, string $targetId): void
    {
        $matches = static fn (array $action): bool => ($action['enabled'] ?? false)
            && ($action['targetType'] ?? null) === $targetType && ($action['targetId'] ?? null) === $targetId;
        if (array_filter($this->storage->read('studio-actions', 'catalog') ?? [], $matches) === []) {
            return;
        }
        $this->storage->transaction('studio-actions', 'catalog', static function (?array &$items) use ($matches): void {
            $items ??= [];
            foreach ($items as &$action) {
                if ($matches($action)) {
                    $action['enabled'] = false;
                    $action['revision'] = ($action['revision'] ?? 0) + 1;
                }
            }
            unset($action);
        });
    }
}
