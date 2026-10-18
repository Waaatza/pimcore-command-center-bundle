<?php
declare(strict_types=1);

namespace Watza\CommandCenterBundle\Service;

use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;

/** @internal */
final readonly class CommandInputResolver
{
    public function validateFields(array $fields): void
    {
        if (!array_is_list($fields) || count($fields) > 30) {
            throw new BadRequestHttpException('Invalid input fields.');
        }
        $names = [];
        foreach ($fields as $field) {
            if (!is_array($field)
                || array_diff(array_keys($field), ['name', 'label', 'type', 'required', 'default', 'choices'])
                || !is_string($field['name'] ?? null)
                || !preg_match('/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/D', $field['name'])
                || in_array($field['name'], $names, true)
                || !is_string($field['label'] ?? null) || trim($field['label']) === '' || strlen($field['label']) > 120
                || !in_array($field['type'] ?? null, ['string', 'integer', 'choice'], true)
                || (isset($field['required']) && !is_bool($field['required']))
                || (isset($field['default']) && (!is_string($field['default']) || strlen($field['default']) > 4096))) {
                throw new BadRequestHttpException('Invalid or duplicate input field.');
            }
            $choices = $field['choices'] ?? [];
            if (!is_array($choices) || !array_is_list($choices) || count($choices) > 100
                || ($field['type'] === 'choice' && $choices === [])) {
                throw new BadRequestHttpException('Choice fields need a list of choices.');
            }
            foreach ($choices as $choice) {
                if (!is_string($choice) || strlen($choice) > 4096 || str_contains($choice, "\0")) {
                    throw new BadRequestHttpException('Invalid choice value.');
                }
            }
            $names[] = $field['name'];
        }
    }

    public function values(array $fields, array $values): array
    {
        $this->validateFields($fields);
        if (array_diff(array_keys($values), array_column($fields, 'name')) !== []) {
            throw new BadRequestHttpException('Unknown input field.');
        }
        foreach ($fields as $field) {
            $value = $values[$field['name']] ?? ($field['default'] ?? '');
            if (!is_string($value) || strlen($value) > 4096 || str_contains($value, "\0")
                || (($field['required'] ?? false) && trim($value) === '')
                || ($field['type'] === 'integer' && $value !== '' && !preg_match('/^-?\d+$/D', $value))
                || ($field['type'] === 'choice' && $value !== '' && !in_array($value, $field['choices'], true))) {
                throw new BadRequestHttpException('Invalid input value: ' . $field['name']);
            }
            $values[$field['name']] = $value;
        }

        return $values;
    }

    public function validateTokens(array $tokens, array $fields): void
    {
        if (!array_is_list($tokens) || count($tokens) > 100) {
            throw new BadRequestHttpException('Invalid arguments.');
        }
        foreach ($tokens as $token) {
            if (!is_string($token) || strlen($token) > 8192 || str_contains($token, "\0")) {
                throw new BadRequestHttpException('Arguments must be strings.');
            }
            preg_match_all('/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/', $token, $matches);
            $remaining = preg_replace('/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/', '', $token);
            if (array_diff($matches[1], array_column($fields, 'name'))
                || str_contains($remaining, '{{') || str_contains($remaining, '}}')) {
                throw new BadRequestHttpException('Unknown or invalid input placeholder.');
            }
        }
    }

    public function tokens(array $tokens, array $values): array
    {
        return array_map(static function (string $token) use ($values): string {
            $resolved = preg_replace_callback('/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/',
                static fn (array $match): string => $values[$match[1]], $token);
            if ((str_starts_with($token, '{{') && str_starts_with($resolved, '-')) || strlen($resolved) > 8192) {
                throw new BadRequestHttpException('Invalid resolved argument.');
            }

            return $resolved;
        }, $tokens);
    }
}
