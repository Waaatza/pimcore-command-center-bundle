<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Parameter;

use Symfony\Component\Validator\Constraints as Assert;

/** @internal */
final readonly class TerminalTicketParameters
{
    public function __construct(
        #[Assert\NotBlank]
        #[Assert\Length(max: 512)]
        public string $csrfToken = '',
        #[Assert\Regex('/^[a-f0-9]{32}$/D')]
        public ?string $sessionId = null,
    ) {
    }
}
