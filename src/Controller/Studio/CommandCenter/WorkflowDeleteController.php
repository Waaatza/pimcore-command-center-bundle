<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Controller\Studio\CommandCenter;

use OpenApi\Attributes as OA;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Watza\CommandCenterBundle\Parameter\WorkflowActionParameters;
use Watza\CommandCenterBundle\Service\CommandWorkflowService;

/** @internal */
final class WorkflowDeleteController
{
    public function __construct(private readonly CommandWorkflowService $service)
    {
    }

    #[Route('/command-center/workflows/delete', name: 'watza_command_center_workflowdelete', methods: ['POST'])]
    #[IsGranted('ROLE_PIMCORE_ADMIN')]
    #[OA\Post(path: '/command-center/workflows/delete', summary: 'command_center_workflowdelete', tags: ['Command Center'])]
    #[OA\Response(response: 204, description: 'command_center_workflowdelete_success')]
    #[OA\Response(response: 403, description: 'Administrator access required')]
    public function __invoke(#[MapRequestPayload] WorkflowActionParameters $parameters): JsonResponse
    {
        $this->service->delete($parameters);
        return new JsonResponse(null, 204);
    }
}
