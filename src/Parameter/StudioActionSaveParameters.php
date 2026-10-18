<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Parameter;

use Symfony\Component\Validator\Constraints as Assert;

/** @internal */
final readonly class StudioActionSaveParameters
{
    public function __construct(
        public string $csrfToken = '',
        public ?string $id = null,
        public ?int $revision = null,
        #[Assert\Length(max: 120)] public string $label = '',
        #[Assert\Length(max: 2048)] public string $icon = 'play',
        public int $position = 0,
        public bool $enabled = false,
        #[Assert\Choice(['template', 'workflow'])] public string $targetType = 'template',
        public string $targetId = '',
        #[Assert\Count(max: 4)] public array $placements = [],
        #[Assert\Count(max: 100)] public array $userIds = [],
        #[Assert\Count(max: 100)] public array $roleIds = [],
        #[Assert\Count(max: 100)] public array $objectClasses = [],
        #[Assert\Choice(['read', 'write'])] public string $elementPermission = 'write',
        public bool $direct = false,
        public bool $showOutput = false,
        #[Assert\Count(max: 30)] public array $bindings = [],
        #[Assert\Choice(['name', 'path'])] public string $iconType = 'name',
    ) {
    }
}
