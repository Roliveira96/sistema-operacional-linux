package domain

// Accepted values of the enumerations, in the words of the descriptions (RN-12).
const (
	enumBlockTypes = "TEXT, COMMAND, TIP, CURIOSITY, STEP_BY_STEP, CARDS, WIDGET"
	enumKinds      = "PRACTICAL, THEORETICAL_SINGLE, THEORETICAL_MULTIPLE, THEORETICAL_BOOLEAN, DISCURSIVE"
	enumUsage      = "EXERCISE, ASSESSMENT"
	enumDifficulty = "EASY, MEDIUM, HARD"
	enumVisibility = "PUBLIC, AUTHENTICATED, PRIVATE"
	enumStatus     = "ACTIVE, INACTIVE, ARCHIVED"
)

const blockPayloadDoc = `Block types: ` + enumBlockTypes + `. Payload of each type (text limits in characters; html is filtered, a safe subset of HTML):
- TEXT: {"title"?: string(<=200), "command"?: string(<=500), "html": string(<=50000; required unless a title is given), "setup"?: snapshot (only with a title, it opens a card)}.
- COMMAND: {"steps": [{"command": string(1..500), "explanation"?: string(<=1000), "outputExplanation"?: string(<=1000), "expectError"?: boolean, "terminal"?: 1..3, "login"?: {"user","password"}, "answers"?: [string]}]} with 1 to 50 steps.
- TIP: {"variant"?: "DEFAULT"|"WARNING", "title"?: string, "html": string}.
- CURIOSITY: {"title"?: string, "html": string}.
- STEP_BY_STEP: {"steps": [string(1..1000)]} with 1 to 50 steps.
- CARDS: {"cards": [{"title": string(1..200), "text": string(1..1000)}]} with 1 to 30 cards.
- WIDGET: {"component": "PERMISSION_CALCULATOR"|"LS_ANATOMY", "params"?: object}.`

const snapshotDoc = `A snapshot is {"summary"?: string(<=500), "steps": [{"command": string(1..500), "terminal"?: 1..3, "login"?: {"user","password"}, "answers"?: [string]}] (<=200 steps), "files"?: [{"path": absolute file path, "content": text, "mode"?: octal like "644", "owner"?: user name, "group"?: group name}] (<=200 files)}.`

const exerciseDoc = `Exercise fields: title (1..200 characters), difficulty (` + enumDifficulty + `), statement (filtered HTML), hints [{"text": string, "command"?: string}] (<=10), solution (a snapshot: the reference recipe), conditions (how the exercise ends, <=100). ` + snapshotDoc + `
A condition is one of: {"kind":"DIR_EXISTS"|"FILE_EXISTS"|"PATH_ABSENT","path"}, {"kind":"FILE_CONTENT","path","match":"equals"|"contains","content"}, {"kind":"MODE","path","mode":"644"}, {"kind":"OWNER","path","owner","group"?}, {"kind":"LINK","path","target"}, {"kind":"USER_EXISTS"|"GROUP_EXISTS","name"}, {"kind":"USER_IN_GROUP","user","name"}. Paths are absolute.
Exercise kinds of the platform: ` + enumKinds + `; the module exercise tools handle PRACTICAL exercises. Links: practice (usage ` + enumUsage + `: in the practice trail), assessment (in the assessment bank) and exclusive (assessment only; needs assessment=true and practice=false). Exercises created or relinked here stay DRAFT: the teacher publishes them in the web app.`

const noPublishNote = ` Everything is written to the DRAFT of the module. Students see nothing until the teacher runs the module test and the exercise bank test and publishes the version in the web app; this server cannot publish or restore versions.`

// Catalog returns the tools of the server with their descriptions and input schemas (SPEC-024 3.2, RN-12).
func Catalog() []ToolSpec {
	id := str("Module id (UUID).")
	return []ToolSpec{
		{Name: ToolListModules, Description: "List the modules the user can edit (a TEACHER sees own modules, an ADMIN sees all), with status and whether the draft has unpublished changes. Status filter: " + enumStatus + ". Visibility filter: " + enumVisibility + ".",
			InputSchema: obj(props{"status": str("Filter by status (" + enumStatus + ")."), "visibility": str("Filter by visibility (" + enumVisibility + ")."), "search": str("Text to search in the title."), "page": integer("Page, from 1."), "limit": integer("Page size.")})},
		{Name: ToolGetModule, Description: "Get a module: data, draft blocks (with ids and updatedAt), snapshot, exercises and versions.",
			InputSchema: obj(props{"moduleId": id}, "moduleId")},
		{Name: ToolCreateModule, Write: true, Description: "Create a module. It starts with an empty version 1 and no blocks. Visibility: " + enumVisibility + " (PRIVATE needs classIds). Dates are RFC 3339. The description is filtered HTML." + noPublishNote,
			InputSchema: obj(props{"title": str("Title."), "description": str("Description (HTML)."), "slug": str("Optional slug: lowercase letters, digits and single hyphens, 3 to 60 characters."), "visibility": str("One of " + enumVisibility + "."), "activationStart": str("RFC 3339 date-time."), "activationEnd": str("RFC 3339 date-time."), "classIds": arr(str("Class id (UUID)."), "Classes, for PRIVATE modules.")}, "title", "description", "visibility")},
		{Name: ToolUpdateModuleMetadata, Write: true, Description: "Edit the data of a module. Only the fields given change; null clears slug, activationStart and activationEnd. Status: " + enumStatus + ". Visibility: " + enumVisibility + ".",
			InputSchema: obj(props{"moduleId": id, "title": str("Title."), "description": str("Description (HTML)."), "slug": nullable("string", "Slug, or null to clear."), "visibility": str("One of " + enumVisibility + "."), "status": str("One of " + enumStatus + "."), "activationStart": nullable("string", "RFC 3339 date-time, or null to clear."), "activationEnd": nullable("string", "RFC 3339 date-time, or null to clear."), "classIds": arr(str("Class id (UUID)."), "Classes, for PRIVATE modules.")}, "moduleId")},
		{Name: ToolArchiveModule, Write: true, Description: "Archive a module (status ARCHIVED): it can no longer be used in new classes; classes and history are kept.",
			InputSchema: obj(props{"moduleId": id}, "moduleId")},
		{Name: ToolAppendContentBlocks, Write: true, Description: "Append blocks to the draft of a module, all or none (atomic). Blocks go to the end, or after afterBlockId. " + blockPayloadDoc + "\n" + snapshotDoc + noPublishNote,
			InputSchema: obj(props{"moduleId": id, "afterBlockId": str("Optional id of the block the new ones go after."), "blocks": blocksSchema()}, "moduleId", "blocks")},
		{Name: ToolUpdateContentBlock, Write: true, Description: "Change one block of the draft. operation: UPDATE (replace the payload; the type never changes), ACTIVATE or DEACTIVATE (students see only active blocks), DELETE. For UPDATE give payload and, to detect concurrent edits, the updatedAt you read in get_module as expectedUpdatedAt (without it the change is forced). " + blockPayloadDoc + noPublishNote,
			InputSchema: obj(props{"moduleId": id, "blockId": str("Block id (UUID)."), "operation": enum("UPDATE", "ACTIVATE", "DEACTIVATE", "DELETE"), "payload": anyValue("New payload, for UPDATE."), "expectedUpdatedAt": str("RFC 3339 updatedAt of the block you read.")}, "moduleId", "blockId", "operation")},
		{Name: ToolReplaceContentBlocks, Write: true, Description: "Replace ALL blocks of the draft with the given ones in a single atomic operation (at most 200 blocks); on any invalid block nothing changes. The blocks are created again, so the reading progress of students on the old ones is lost. " + blockPayloadDoc + "\n" + snapshotDoc + noPublishNote,
			InputSchema: obj(props{"moduleId": id, "blocks": blocksSchema()}, "moduleId", "blocks")},
		{Name: ToolSetModuleSetup, Write: true, Description: "Set the snapshot of the module: the initial state of the machine of the student (commands and files). " + snapshotDoc + noPublishNote,
			InputSchema: obj(props{"moduleId": id, "setup": anyValue("The snapshot object.")}, "moduleId", "setup")},
		{Name: ToolCreateModuleExercise, Write: true, Description: "Create an exercise in the exercise bank of the module, as a DRAFT. " + exerciseDoc + noPublishNote,
			InputSchema: obj(props{"moduleId": id, "title": str("Title."), "difficulty": str("One of " + enumDifficulty + "."), "statement": str("Statement (HTML)."), "hints": anyValue("List of hints."), "solution": anyValue("Reference solution, a snapshot."), "conditions": anyValue("List of end conditions."), "dependsOn": str("Id of the exercise of the module this one continues from."), "links": linksSchema()}, "moduleId", "title", "difficulty")},
		{Name: ToolUpdateModuleExercise, Write: true, Description: "Change an exercise of the module. operation: UPDATE (the fields given replace the stored ones; dependsOn null clears the dependency), SET_LINKS (give links), DELETE, REORDER (give order: the exact list of exercises of the practice, with mandatory flags). " + exerciseDoc + noPublishNote,
			InputSchema: obj(props{"moduleId": id, "exerciseId": str("Exercise id (UUID), not used by REORDER."), "operation": enum("UPDATE", "SET_LINKS", "DELETE", "REORDER"), "title": str("Title."), "difficulty": str("One of " + enumDifficulty + "."), "statement": str("Statement (HTML)."), "hints": anyValue("List of hints."), "solution": anyValue("Reference solution, a snapshot."), "conditions": anyValue("List of end conditions."), "dependsOn": nullable("string", "Exercise id, or null to clear."), "links": linksSchema(), "updatedAt": str("RFC 3339 updatedAt of the exercise you read; without it the change is forced."), "order": arr(obj(props{"exerciseId": str("Exercise id."), "mandatory": map[string]any{"type": "boolean"}}, "exerciseId"), "Trail order, for REORDER.")}, "moduleId", "operation")},
		{Name: ToolSetExerciseSetup, Write: true, Description: "Define the scenario of the exercises. With exerciseId: set the recipe (solution) of that exercise and/or the exercise it continues from (dependsOn; null clears), which builds the chain of scenarios. Without exerciseId: set the snapshot shared by the exercises of the module (bankSetup; null removes it). " + snapshotDoc + noPublishNote,
			InputSchema: obj(props{"moduleId": id, "exerciseId": str("Exercise id (UUID)."), "solution": anyValue("Recipe of the exercise, a snapshot."), "dependsOn": nullable("string", "Exercise it continues from, or null to clear."), "bankSetup": anyValue("Snapshot shared by the exercises of the module, or null.")}, "moduleId")},
		{Name: ToolValidateModule, Description: "Run the structural validations of the draft (blocks, snapshots, exercises and their references) and list every problem with its field path. It does not run commands. A clean result does not publish anything: to publish, the teacher must run the module test and the exercise bank test and publish the version in the web app; tell the teacher so.",
			InputSchema: obj(props{"moduleId": id}, "moduleId")},
		{Name: ToolListModuleVersions, Description: "List the published versions of a module (newest first, the current one marked) and whether the draft has unpublished changes. Read only.",
			InputSchema: obj(props{"moduleId": id}, "moduleId")},
	}
}

type props = map[string]any

func obj(p props, required ...string) map[string]any {
	m := map[string]any{"type": "object", "properties": p}
	if len(required) > 0 {
		m["required"] = required
	}
	return m
}

func str(desc string) map[string]any { return map[string]any{"type": "string", "description": desc} }

func integer(desc string) map[string]any {
	return map[string]any{"type": "integer", "description": desc}
}

func arr(items map[string]any, desc string) map[string]any {
	return map[string]any{"type": "array", "items": items, "description": desc}
}

func enum(values ...string) map[string]any { return map[string]any{"type": "string", "enum": values} }

func nullable(typ, desc string) map[string]any {
	return map[string]any{"type": []string{typ, "null"}, "description": desc}
}

// anyValue accepts any JSON value; the service validates the shape and answers with the fields at fault.
func anyValue(desc string) map[string]any { return map[string]any{"description": desc} }

func blocksSchema() map[string]any {
	return arr(obj(props{"type": str("One of " + enumBlockTypes + "."), "payload": anyValue("Payload of the type.")}, "type", "payload"), "Blocks, in order.")
}

func linksSchema() map[string]any {
	b := map[string]any{"type": "boolean"}
	return obj(props{"practice": b, "assessment": b, "exclusive": b})
}
