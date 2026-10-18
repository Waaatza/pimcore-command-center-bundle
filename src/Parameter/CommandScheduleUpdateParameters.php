<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Parameter;

use Symfony\Component\Validator\Constraints as Assert;

/** @internal */
final readonly class CommandScheduleUpdateParameters
{
    public function __construct(
        #[Assert\Regex('/^[a-f0-9]{32}$/')]
        public string $id = '',
        #[Assert\Valid]
        public CommandScheduleParameters $schedule = new CommandScheduleParameters(),
        public bool $enabled = true,
        #[Assert\PositiveOrZero]
        public int $revision = 0,
    ) {
    }
}
