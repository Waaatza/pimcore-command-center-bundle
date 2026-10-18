<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\DependencyInjection;

use Symfony\Component\Config\Definition\Builder\TreeBuilder;
use Symfony\Component\Config\Definition\ConfigurationInterface;

/** @internal */
final class Configuration implements ConfigurationInterface
{
    public function getConfigTreeBuilder(): TreeBuilder
    {
        $tree = new TreeBuilder('pimcore_command_center');
        $tree->getRootNode()->children()
            ->arrayNode('terminal')->addDefaultsIfNotSet()->children()
                ->booleanNode('enabled')->defaultFalse()->end()
                ->scalarNode('secret')->defaultValue('')->end()
                ->scalarNode('origin')->defaultValue('')->end()
                ->scalarNode('websocket_path')->defaultValue('/command-center-terminal')->end()
            ->end()->end()
        ->end();

        return $tree;
    }
}
