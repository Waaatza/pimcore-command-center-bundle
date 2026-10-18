<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use OpenApi\Attributes as OA;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Watza\CommandCenterBundle\Service\StudioActionService;

/** @internal */
final class StudioActionsController
{
    public function __construct(private readonly StudioActionService $service)
    {
    }

    #[Route(
        '/command-center/actions/admin',
        name: 'watza_command_center_studioactions',
        methods: ['GET'],
    )]
    #[IsGranted('ROLE_PIMCORE_ADMIN')]
    #[OA\Get(
        path: '/command-center/actions/admin', summary: 'command_center_studioactions', tags: ['Command Center'],
    )]
    #[OA\Response(response: 200, description: 'command_center_studioactions_success')]
    #[OA\Response(response: 403, description: 'Access denied')]
    public function __invoke(): JsonResponse
    {
        return new JsonResponse($this->service->adminList(), headers: ['Cache-Control' => 'no-store']);
    }
}
