<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use OpenApi\Attributes as OA;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Watza\CommandCenterBundle\Service\CommandWorkflowService;

/** @internal */
final class WorkflowsController
{
    public function __construct(private readonly CommandWorkflowService $service)
    {
    }

    #[Route('/command-center/workflows', name: 'watza_command_center_workflows', methods: ['GET'])]
    #[IsGranted('ROLE_PIMCORE_ADMIN')]
    #[OA\Get(path: '/command-center/workflows', summary: 'command_center_workflows', tags: ['Command Center'])]
    #[OA\Response(response: 200, description: 'command_center_workflows_success')]
    #[OA\Response(response: 403, description: 'Administrator access required')]
    public function __invoke(): JsonResponse
    {
        return new JsonResponse($this->service->list(), 200, ['Cache-Control' => 'private, no-store']);
    }
}
