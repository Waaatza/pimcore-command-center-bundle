<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Parameter;

use Symfony\Component\Validator\Constraints as Assert;

/** @internal */
final readonly class ScheduleNotificationsParameters
{
    public function __construct(
        #[Assert\Regex('/^[a-f0-9]{32}$/')]
        public string $id = '',
        #[Assert\NotBlank]
        public string $csrfToken = '',
        #[Assert\Count(max: 50)]
        #[Assert\All([new Assert\Type('integer'), new Assert\Positive()])]
        public array $notificationRecipientIds = [],
        #[Assert\Choice(choices: ['email', 'studio'], multiple: true)]
        public array $notificationChannels = [],
    ) {
    }
}
