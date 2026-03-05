# Glossary of Terms for Non-ML people

## Cascaded Model

- Where instead of a model completing a task all with 1 architecture, we instead break down this task into smaller subtasks, and have 1 model handle each subtask.
- i.e. instead of making the model figure out what to do with our spoken instructions, we have 1 model turn our audio recording into
- Its really just a form of orchestration.
- the Meralion paper references this multiple times, but basically refers to this to demonstrate that maybe a model orchestration performs better than the single proposed model.
    - useful if you just want to see which is more efficient, orchesteration or the vanilla multi-task model.
