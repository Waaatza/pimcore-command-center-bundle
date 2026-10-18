<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Parameter;

use Symfony\Component\Validator\Constraints as Assert;

/** @internal */
final readonly class CommandScheduleActionParameters
{
    public function __construct(
        #[Assert\Regex('/^[a-f0-9]{32}$/')]
        public string $id = '',
        #[Assert\NotBlank]
        public string $csrfToken = '',
        #[Assert\Choice(['enable', 'disable', 'delete'])]
        public string $action = '',
    ) {
    }
}
