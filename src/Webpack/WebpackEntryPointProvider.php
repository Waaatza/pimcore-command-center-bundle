<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Webpack;

use Pimcore\Bundle\StudioUiBundle\Webpack\WebpackEntryPointProviderInterface;

/**
 * @internal
 */
final class WebpackEntryPointProvider implements WebpackEntryPointProviderInterface
{
    public function getEntryPointsJsonLocations(): array
    {
        return glob(__DIR__ . '/../../public/build/*/entrypoints.json') ?: [];
    }

    public function getEntryPoints(): array
    {
        return ['exposeRemote'];
    }

    public function getOptionalEntryPoints(): array
    {
        return [];
    }
}
