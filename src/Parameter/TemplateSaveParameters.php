<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Parameter;

use Symfony\Component\Validator\Constraints as Assert;

/** @internal */
final readonly class TemplateSaveParameters
{
    public function __construct(
        #[Assert\NotBlank] public string $csrfToken = '',
        #[Assert\NotBlank, Assert\Length(max: 120)] public string $label = '',
        #[Assert\NotBlank, Assert\Length(max: 200)] public string $command = '',
        #[Assert\Length(max: 2000)] public string $description = '',
        #[Assert\Count(max: 100)] public array $tokens = [],
        #[Assert\Count(max: 30)] public array $fields = [],
        public ?string $id = null,
        #[Assert\PositiveOrZero] public ?int $revision = null,
    ) {
    }
}
