<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Parameter;

use Symfony\Component\Validator\Constraints as Assert;

/** @internal */
final readonly class StudioActionRequest
{
    public function __construct(
        #[Assert\Length(max: 512)] public string $csrfToken = '',
        #[Assert\Length(max: 32)] public string $id = '',
        public ?int $revision = null,
        public ?int $targetRevision = null,
        #[Assert\Choice(['global', 'object', 'asset', 'document'])] public string $placement = 'global',
        public ?array $context = null,
        #[Assert\Count(max: 30)] public array $values = [],
        #[Assert\Length(max: 32)] public string $runId = '',
    ) {
    }
}
