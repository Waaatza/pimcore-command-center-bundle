<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

use Symfony\Component\DependencyInjection\Attribute\TaggedIterator;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Watza\CommandCenterBundle\Parameter\CommandRunParameters;
use Watza\CommandCenterBundle\Parameter\TemplateActionParameters;
use Watza\CommandCenterBundle\Parameter\TemplateSaveParameters;
use Watza\CommandCenterBundle\Preview\CommandPreviewProviderInterface;

/** @internal */
final readonly class CommandTemplateService
{
    public function __construct(
        private PrivateJsonStorage $storage,
        private CommandCenterService $commands,
        #[TaggedIterator('command_center.preview_provider')]
        private iterable $previewProviders = [],
    ) {
    }

    public function list(): array
    {
        $items = array_values($this->storage->read('templates', 'catalog') ?? []);
        usort($items, static fn (array $a, array $b): int => strnatcasecmp($a['label'], $b['label']));
        foreach ($items as &$item) {
            $item['previewSupported'] = $this->provider($item['command']) !== null;
        }

        return ['items' => $items];
    }

    public function save(TemplateSaveParameters $parameters): array
    {
        $this->commands->verifyCsrf($parameters->csrfToken);
        $this->validateDefinition($parameters);
        $this->commands->validate(new CommandRunParameters($parameters->command, tokens: $parameters->tokens));

        return $this->storage->transaction('templates', 'catalog', function (?array &$items) use ($parameters): array {
            $items ??= [];
            $id = $parameters->id ?? bin2hex(random_bytes(16));
            $old = $parameters->id === null ? null : $this->find($items, $id, $parameters->revision);
            $item = [
                'id' => $id, 'revision' => ($old['revision'] ?? 0) + 1,
                'label' => trim($parameters->label), 'description' => trim($parameters->description),
                'command' => $parameters->command, 'tokens' => $parameters->tokens, 'fields' => $parameters->fields,
                'createdAt' => $old['createdAt'] ?? gmdate(DATE_ATOM), 'updatedAt' => gmdate(DATE_ATOM),
            ];
            $items[$id] = $item;

            return $item;
        });
    }

    public function delete(TemplateActionParameters $parameters): void
    {
        $this->commands->verifyCsrf($parameters->csrfToken);
        $this->storage->transaction('templates', 'catalog', function (?array &$items) use ($parameters): void {
            $this->find($items ?? [], $parameters->id, $parameters->revision);
            unset($items[$parameters->id]);
        });
    }

    public function preview(TemplateActionParameters $parameters): array
    {
        [$item, $run] = $this->resolve($parameters);
        $provider = $this->provider($item['command']);
        if ($provider === null) {
            return ['supported' => false];
        }
        $result = $provider->preview($run->tokens);

        return ['supported' => true, 'count' => $result->count, 'samples' => $result->samples,
            'message' => $result->message];
    }

    public function run(TemplateActionParameters $parameters): StreamedResponse
    {
        [$item, $run] = $this->resolve($parameters);

        return $this->commands->run($run, [
            'source' => 'template', 'templateId' => $item['id'], 'templateLabel' => $item['label'],
        ]);
    }

    /** @return array{array, CommandRunParameters} */
    private function resolve(TemplateActionParameters $parameters): array
    {
        $this->commands->verifyCsrf($parameters->csrfToken);
        $item = $this->find($this->storage->read('templates', 'catalog') ?? [], $parameters->id, $parameters->revision);
        $values = $parameters->values;
        $known = array_column($item['fields'], 'name');
        if (array_diff(array_keys($values), $known) !== []) {
            throw new BadRequestHttpException('Unknown template field.');
        }
        foreach ($item['fields'] as $field) {
            $value = $values[$field['name']] ?? ($field['default'] ?? '');
            if (!is_string($value) || strlen($value) > 4096 || str_contains($value, "\0")
                || (($field['required'] ?? false) && trim($value) === '')
                || (($field['type'] === 'integer') && $value !== '' && !preg_match('/^-?\d+$/D', $value))
                || (($field['type'] === 'choice') && $value !== '' && !in_array($value, $field['choices'], true))) {
                throw new BadRequestHttpException('Invalid template value: ' . $field['name']);
            }
            $values[$field['name']] = $value;
        }
        $tokens = array_map(static function (string $token) use ($values): string {
            $resolved = preg_replace_callback('/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/',
                static fn (array $match): string => $values[$match[1]], $token);
            // A positional placeholder must not introduce a new CLI option.
            if (str_starts_with($token, '{{') && str_starts_with($resolved, '-')) {
                throw new BadRequestHttpException('A positional template value cannot start with a dash.');
            }
            if (strlen($resolved) > 8192) {
                throw new BadRequestHttpException('Resolved argument is too long.');
            }

            return $resolved;
        }, $item['tokens']);
        $run = new CommandRunParameters($item['command'], $parameters->csrfToken, $tokens);
        $this->commands->validate($run);

        return [$item, $run];
    }

    private function find(array $items, string $id, ?int $revision): array
    {
        $item = $items[$id] ?? throw new NotFoundHttpException('Template not found.');
        if ($revision !== $item['revision']) {
            throw new ConflictHttpException('Template changed. Reload before continuing.');
        }

        return $item;
    }

    private function validateDefinition(TemplateSaveParameters $parameters): void
    {
        if (trim($parameters->label) === '' || strlen($parameters->label) > 120
            || strlen($parameters->description) > 2000 || !array_is_list($parameters->tokens)
            || count($parameters->tokens) > 100 || !array_is_list($parameters->fields)
            || count($parameters->fields) > 30) {
            throw new BadRequestHttpException('Invalid template definition.');
        }
        $names = [];
        foreach ($parameters->fields as $field) {
            if (!is_array($field) || array_diff(array_keys($field), ['name', 'label', 'type', 'required', 'default', 'choices'])
                || !is_string($field['name'] ?? null) || !preg_match('/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/D', $field['name'])
                || in_array($field['name'], $names, true) || !is_string($field['label'] ?? null)
                || trim($field['label']) === '' || strlen($field['label']) > 120
                || !in_array($field['type'] ?? null, ['string', 'integer', 'choice'], true)
                || (isset($field['required']) && !is_bool($field['required']))
                || (isset($field['default']) && (!is_string($field['default']) || strlen($field['default']) > 4096))) {
                throw new BadRequestHttpException('Invalid or duplicate template field.');
            }
            $choices = $field['choices'] ?? [];
            if (!is_array($choices) || !array_is_list($choices) || count($choices) > 100
                || ($field['type'] === 'choice' && $choices === [])) {
                throw new BadRequestHttpException('Choice fields need a list of choices.');
            }
            foreach ($choices as $choice) {
                if (!is_string($choice) || strlen($choice) > 4096) {
                    throw new BadRequestHttpException('Invalid choice value.');
                }
            }
            $names[] = $field['name'];
        }
        foreach ($parameters->tokens as $token) {
            if (!is_string($token) || strlen($token) > 8192) {
                throw new BadRequestHttpException('Arguments must be strings.');
            }
            preg_match_all('/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/', $token, $matches);
            $remaining = preg_replace('/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/', '', $token);
            if (array_diff($matches[1], $names) || str_contains($remaining, '{{') || str_contains($remaining, '}}')) {
                throw new BadRequestHttpException('Unknown or invalid template placeholder.');
            }
        }
    }

    private function provider(string $command): ?CommandPreviewProviderInterface
    {
        $found = null;
        foreach ($this->previewProviders as $provider) {
            if ($provider->command() === $command) {
                if ($found !== null) {
                    throw new \LogicException('Multiple preview providers registered for ' . $command);
                }
                $found = $provider;
            }
        }

        return $found;
    }
}
