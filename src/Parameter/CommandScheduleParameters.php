<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Parameter;

use Symfony\Component\Validator\Constraints as Assert;

/** @internal */
final readonly class CommandScheduleParameters
{
    public function __construct(
        #[Assert\Valid]
        public CommandRunParameters $execution = new CommandRunParameters(),
        #[Assert\NotBlank]
        #[Assert\Length(max: 120)]
        public string $label = '',
        #[Assert\NotBlank]
        public string $runAt = '',
        #[Assert\Choice(['once', 'hourly', 'daily', 'weekly'])]
        public string $repeat = 'once',
        #[Assert\Timezone]
        public string $timezone = 'Europe/Berlin',
    ) {
    }
}
