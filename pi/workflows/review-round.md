name: review-round
description: Review changed files with UI and performance lenses in parallel, then merge into one verdict
params:
  - { name: changed_files, required: true }
  - { name: context, default: "First review pass." }
flow:
  kind: sequence
  steps:
    - kind: parallel
      as: reviews
      onError: fail
      branches:
        ui:
          kind: agent
          profile: ui-reviewer
          task: |-
            Review this change set: {params.changed_files}
            {params.context}
            Skip non-frontend files.
          json: &review_schema
            type: object
            required: [outcome, findings, report]
            properties:
              outcome: { enum: [approved, changes_required] }
              findings:
                type: array
                items:
                  type: object
                  required: [severity, location, issue, fix]
                  properties:
                    severity: { enum: [blocker, should_fix, nit] }
                    location: { type: string }
                    issue: { type: string }
                    fix: { type: string }
              report: { type: string }
            additionalProperties: false
        perf:
          kind: agent
          profile: perf-reviewer
          task: |-
            Review this change set: {params.changed_files}
            {params.context}
          json: *review_schema
    - kind: agent
      task: |-
        Merge these two code reviews into one verdict.

        UI review: {reviews.ui}
        Performance review: {reviews.perf}

        Rules:
        - outcome is changes_required if either review has a blocker or
          should_fix finding; nits alone mean approved.
        - actionable is a deduplicated, prioritized list of concrete fixes
          (blockers first), each with file location. Exclude nits.
        - report is a short Markdown summary of both reviews, nits included
          as an FYI section.
      json:
        type: object
        required: [outcome, actionable, report]
        properties:
          outcome: { enum: [approved, changes_required] }
          actionable:
            type: array
            items: { type: string }
          report: { type: string }
        additionalProperties: false
