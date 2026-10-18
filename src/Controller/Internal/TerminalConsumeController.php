<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Internal;

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Watza\CommandCenterBundle\Parameter\TerminalConsumeParameters;
use Watza\CommandCenterBundle\Service\TerminalService;

/** @internal */
final class TerminalConsumeController
{
    public function __construct(private readonly TerminalService $service)
    {
    }

    // Separater Maschinenzugang außerhalb der Studio-Session-Firewall, durch Dienstgeheimnis geschützt.
    #[Route(
        '/command-center-internal/terminal/consume',
        name: 'watza_command_center_terminal_consume',
        methods: ['POST'],
    )]
    public function __invoke(#[MapRequestPayload] TerminalConsumeParameters $parameters): JsonResponse
    {
        return new JsonResponse($this->service->consume($parameters), headers: ['Cache-Control' => 'no-store']);
    }
}
