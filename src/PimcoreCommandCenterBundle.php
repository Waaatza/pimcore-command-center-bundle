<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle;

use Pimcore\Extension\Bundle\AbstractPimcoreBundle;

/** @internal */
final class PimcoreCommandCenterBundle extends AbstractPimcoreBundle
{
    public function getPath(): string
    {
        return dirname(__DIR__);
    }
}
