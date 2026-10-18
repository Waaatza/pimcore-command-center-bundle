<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Parameter;

use Symfony\Component\Validator\Constraints as Assert;

/** @internal */
final readonly class HistoryQueryParameters
{
    public function __construct(
        public int $page = 1,
        #[Assert\Length(max: 40)]
        public string $status = '',
        #[Assert\Length(max: 40)]
        public string $source = '',
        #[Assert\Length(max: 120)]
        public string $search = '',
    ) {
    }
}
