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
final class WorkflowRunController
{
    public function __construct(private readonly CommandWorkflowService $service)
    {
    }

    #[Route('/command-center/workflows/run', name: 'watza_command_center_workflowrun', methods: ['POST'])]
    #[IsGranted('ROLE_PIMCORE_ADMIN')]
    #[OA\Post(path: '/command-center/workflows/run', summary: 'command_center_workflowrun', tags: ['Command Center'])]
    #[OA\Response(response: 202, description: 'command_center_workflowrun_success')]
    #[OA\Response(response: 403, description: 'Administrator access required')]
    public function __invoke(#[MapRequestPayload] WorkflowActionParameters $parameters): JsonResponse
    {
        return new JsonResponse($this->service->queue($parameters), 202, ['Cache-Control' => 'private, no-store']);
    }
}
