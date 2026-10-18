<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Parameter;

use Symfony\Component\Validator\Constraints as Assert;

/** @internal */
final readonly class WorkflowActionParameters
{
    public function __construct(
        #[Assert\NotBlank] public string $csrfToken = '',
        #[Assert\Regex('/^[a-f0-9]{32}$/D')] public string $id = '',
        #[Assert\Positive] public int $revision = 0,
        #[Assert\Count(max: 30)] public array $values = [],
    ) {
    }
}
