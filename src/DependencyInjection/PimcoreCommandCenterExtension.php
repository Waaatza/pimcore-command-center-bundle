<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\DependencyInjection;

use Symfony\Component\Config\FileLocator;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Loader\YamlFileLoader;
use Symfony\Component\HttpKernel\DependencyInjection\Extension;
use Watza\CommandCenterBundle\Preview\CommandPreviewProviderInterface;

/** @internal */
final class PimcoreCommandCenterExtension extends Extension
{
    public function load(array $configs, ContainerBuilder $container): void
    {
        $config = $this->processConfiguration(new Configuration(), $configs);
        $container->setParameter('command_center.terminal', $config['terminal']);
        $container->registerForAutoconfiguration(CommandPreviewProviderInterface::class)
            ->addTag('command_center.preview_provider');

        (new YamlFileLoader($container, new FileLocator(__DIR__ . '/../../config')))->load('services.yaml');
    }
}
