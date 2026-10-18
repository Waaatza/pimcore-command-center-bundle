<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Parameter;

use Symfony\Component\Validator\Constraints as Assert;

/** @internal */
final readonly class TerminalConsumeParameters
{
    public function __construct(
        #[Assert\Regex('/^[a-f0-9]{64}$/D')]
        #[Assert\NotBlank]
        public string $ticket = '',
    ) {
    }
}
