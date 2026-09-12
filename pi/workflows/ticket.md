name: ticket
description: Full pipeline - triage a ticket, spec it, write tests, implement, review, and fix until approved
trigger: when the user asks to run a ticket through the build pipeline
display: report
params:
  - { name: ticket, required: true }
flow:
  kind: sequence
  steps:
    # 1. Product triage: is this ticket actionable?
    - kind: agent
      profile: product-triage
      as: triage
      task: |-
        Triage this ticket:

        {params.ticket}
      json:
        type: object
        required: [ready, refined_ticket, questions, report]
        properties:
          ready: { type: boolean }
          refined_ticket: { type: string }
          questions:
            type: array
            items: { type: string }
          report: { type: string }
        additionalProperties: false

    # 2. Gate: only build if ready; otherwise return the questions.
    - kind: switch
      on: "{triage}"
      cases:
        - when: { eq: [ready, true] }
          then:
            kind: sequence
            steps:
              # 3. Architect turns the refined ticket into a spec.
              - kind: agent
                profile: architect
                as: spec
                task: |-
                  Write an implementation spec for this ticket:

                  {triage.refined_ticket}
                json:
                  type: object
                  required: [spec, files, open_questions, report]
                  properties:
                    spec: { type: string }
                    files:
                      type: array
                      items: { type: string }
                    open_questions:
                      type: array
                      items: { type: string }
                    report: { type: string }
                  additionalProperties: false

              # 4. Tests from requirements + spec (black-box, may fail now).
              - kind: agent
                profile: test-author
                as: tests
                task: |-
                  Write tests for this ticket. Derive expectations from the
                  requirements and spec only.

                  Ticket: {triage.refined_ticket}

                  Spec: {spec.spec}
                json:
                  type: object
                  required: [test_files, uncovered, report]
                  properties:
                    test_files:
                      type: array
                      items: { type: string }
                    uncovered:
                      type: array
                      items: { type: string }
                    report: { type: string }
                  additionalProperties: false

              # 5. Implement the spec; make the tests pass.
              - kind: agent
                profile: implementer
                as: build
                task: |-
                  Implement this spec. The tests in {tests.test_files} define
                  done; do not modify them.

                  Spec: {spec.spec}
                json: &build_schema
                  type: object
                  required: [outcome, changed_files, flagged, report]
                  properties:
                    outcome: { enum: [done, blocked] }
                    changed_files:
                      type: array
                      items: { type: string }
                    flagged:
                      type: array
                      items: { type: string }
                    report: { type: string }
                  additionalProperties: false

              # 6. First review round (parallel UI + perf, merged verdict).
              - kind: workflow
                name: review-round
                as: first_review
                params:
                  changed_files: "{build.changed_files}"

              # 7. Fix -> re-review until approved (or max rounds).
              - kind: while
                as: final_review
                on: "{first_review}"
                condition: { eq: [outcome, changes_required] }
                max: 3
                body:
                  kind: sequence
                  steps:
                    - kind: agent
                      profile: implementer
                      as: fix
                      task: |-
                        Address these review findings without breaking tests
                        or expanding scope:

                        {current.actionable}

                        Original spec: {spec.spec}
                      json: *build_schema
                    - kind: workflow
                      name: review-round
                      params:
                        changed_files: "{fix.changed_files}"
                        context: "Re-review after fixes, round {iteration}."

              # 8. Assemble the human-facing result.
              - kind: value
                value:
                  outcome: "{final_review.outcome}"
                  report: |-
                    ## Triage
                    {triage.report}

                    ## Spec
                    {spec.report}

                    ## Tests
                    {tests.report}

                    ## Implementation
                    {build.report}

                    ## Final review
                    {final_review.report}
      else:
        kind: value
        value:
          outcome: needs_info
          report: |-
            ## Ticket not ready

            {triage.report}

            ### Questions to resolve
            {triage.questions}
