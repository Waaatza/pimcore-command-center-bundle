<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Parameter;

use Symfony\Component\Validator\Constraints as Assert;

/** @internal */
final readonly class CommandRunParameters
{
    public function __construct(
        #[Assert\NotBlank]
        public string $command = '',
        #[Assert\NotBlank]
        public string $csrfToken = '',
        #[Assert\Count(max: 100)]
        #[Assert\All([new Assert\Type('string'), new Assert\Length(max: 8192)])]
        public array $tokens = [],
        #[Assert\Length(max: 1000000)]
        public ?string $phpCode = null,
    ) {
    }
}
