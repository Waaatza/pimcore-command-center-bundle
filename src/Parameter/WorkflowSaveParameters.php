<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Parameter;

use Symfony\Component\Validator\Constraints as Assert;

/** @internal */
final readonly class WorkflowSaveParameters
{
    public function __construct(
        #[Assert\NotBlank] public string $csrfToken = '',
        #[Assert\NotBlank, Assert\Length(max: 120)] public string $label = '',
        #[Assert\Length(max: 2000)] public string $description = '',
        #[Assert\Count(min: 1, max: 20)] public array $steps = [],
        public ?string $id = null,
        public ?int $revision = null,
    ) {
    }
}
