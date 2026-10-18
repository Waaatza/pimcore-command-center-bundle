<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use OpenApi\Attributes as OA;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Watza\CommandCenterBundle\Parameter\WorkflowSaveParameters;
use Watza\CommandCenterBundle\Service\CommandWorkflowService;

/** @internal */
final class WorkflowSaveController
{
    public function __construct(private readonly CommandWorkflowService $service)
    {
    }

    #[Route('/command-center/workflows/save', name: 'watza_command_center_workflowsave', methods: ['POST'])]
    #[IsGranted('ROLE_PIMCORE_ADMIN')]
    #[OA\Post(path: '/command-center/workflows/save', summary: 'command_center_workflowsave', tags: ['Command Center'])]
    #[OA\Response(response: 200, description: 'command_center_workflowsave_success')]
    #[OA\Response(response: 403, description: 'Administrator access required')]
    public function __invoke(#[MapRequestPayload] WorkflowSaveParameters $parameters): JsonResponse
    {
        return new JsonResponse($this->service->save($parameters), 200, ['Cache-Control' => 'private, no-store']);
    }
}
