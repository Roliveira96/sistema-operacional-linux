# Glossário do Domínio (PT ↔ EN)

Linguagem ubíqua do projeto. As specs e a conversa usam o **termo em português**. Todo código usa **exatamente** o nome em inglês desta tabela: tipos, tabelas, rotas, eventos e enumerações.

Regras:

- Termo novo só entra por spec (seção 9) e é registrado aqui na mesma entrega.
- Sinônimos listados em "Evitar" **não** podem aparecer no código.
- Status **Canônico** = vem de `docs/arquitetura/transicao-backend.md`. Status **Decidido** = definido pelo Tech Lead. Status **Proposto** = nome sugerido que ainda precisa do aval do Tech Lead.

---

## 1. Pessoas e acesso

| Português | Código (EN) | Definição | Evitar | Status |
| :--- | :--- | :--- | :--- | :--- |
| Usuário | `User` | Conta autenticável na plataforma | `Account`, `Person` | Canônico |
| Perfil (papel) | `Role` | `ADMIN`, `TEACHER` ou `STUDENT` | `Profile`, `Type` | Canônico |
| Docente / Professora | `Teacher` (papel `TEACHER`) | Usuário que gerencia turmas e avaliações | `Professor`, `Instructor` | Canônico |
| Estudante / Aluno / Discente | `Student` (papel `STUDENT`) | Usuário matriculado em turmas | `Pupil`, `Learner` | Canônico |
| Administrador | `Admin` (papel `ADMIN`) | Gestão institucional da plataforma | `Superuser` | Canônico |
| Status da conta | `ACTIVE`, `INACTIVE`, `SUSPENDED` | Situação da conta do usuário; a semântica de `SUSPENDED` está pendente (SPEC-003, P-09) | `ENABLED`, `BLOCKED` | Decidido |
| Troca de senha obrigatória | `must_change_password` | Indicador que obriga a trocar a senha no próximo acesso | `first_login` | Decidido |
| Perfil do estudante | `StudentProfile` | Dados complementares do estudante (WhatsApp, Discord, avatar) | `StudentData` | Proposto |
| RA (Registro Acadêmico) | `academic_id` | Identificador institucional UTFPR do estudante: exatamente 7 dígitos, aceito na entrada com prefixo opcional "a" ou "A" | `ra`, `registration` | Decidido (formato); nome e tabela em SPEC-003, P-02 |

## 2. Turmas e matrículas

| Português | Código (EN) | Definição | Evitar | Status |
| :--- | :--- | :--- | :--- | :--- |
| Disciplina | `Course` | Componente curricular (ex.: Sistemas Operacionais, código SI34E) | `Subject`, `Discipline` | Canônico |
| Turma | `ClassGroup` | Oferta de uma disciplina em um semestre, com docente responsável | `Class` (palavra reservada em várias linguagens), `Classroom` (confunde com sala física), `Team`, `Group` | Proposto |
| Resumo da disciplina | `summary` (campo de `ClassGroup`) | Texto curto, escrito pela docente, que apresenta a turma no card e na página da turma | `description`, `abstract` | Proposto (SPEC-041) |
| Ementa | `syllabus` (campo de `ClassGroup`) | Conteúdo programático da disciplina na turma, em texto formatado | `program`, `curriculum` | Proposto (SPEC-041) |
| Diretrizes institucionais | `institutionalGuidelines` (campo de `ClassGroup`; coluna `institutional_guidelines`) | Regras de frequência, avaliação e conduta da turma, em texto formatado | `rules`, `policies` | Proposto (SPEC-041) |
| Matrícula (inscrição na turma) | `Enrollment` | Vínculo de um estudante com uma turma e o ciclo de vida desse vínculo | `Registration`, `Subscription`, `Inscription` | Canônico |
| Status da matrícula | `PENDING_MODERATION`, `ACTIVE`, `REJECTED`, `TRANSFERRED`, `UNENROLLED` | Ciclo de vida do vínculo com a turma | `PENDING`, `APPROVED`, `REMOVED` | Decidido (`REJECTED` e `UNENROLLED` propostos na SPEC-002) |
| Origem da matrícula | `INVITE_LINK`, `CSV_IMPORT`, `DIRECT_BY_TEACHER` | Por qual via o estudante entrou na turma | — | Canônico |
| Pré-matrícula | `PRE_ENROLLED` (status) | Estudante importado da lista que ainda não ativou a conta | — | Canônico; uso em discussão (SPEC-002, P-10) |
| Moderação (deferir / indeferir) | `approve` / `reject` | Decisão docente sobre um pedido de matrícula feito por link | `accept`, `deny` | Canônico |
| Remanejamento | `Transfer` | Mudança do estudante de uma turma para outra, com rastreabilidade | `Move`, `Migration` | Canônico |
| Link de convite | `InviteLink` | URL compartilhável para pedir matrícula na turma | `JoinLink` | Canônico |
| Link da turma | `ClassLink` (tabela `class_links`) | Endereço https com nome que a docente publica na turma, como o da sala do Meet ou o do conteúdo. Não confundir com o link de convite | `InviteLink` (é o link de matrícula), `Resource`, `Bookmark` | Proposto (SPEC-048) |
| Sala ao vivo (aula síncrona) | `LiveClassroomSession` (tabela `live_classroom_sessions`) | Aula conduzida em tempo real pela docente, com slides ou módulo espelhado; no máximo uma ativa por turma. Não confundir com a aula da agenda (`ClassSession`) nem com a sessão de login (`AuthSession`) | `Session` sozinho, `Meeting` | Proposto (SPEC-051) |
| Apresentação | `SlideDeck` (tabela `slide_decks`) | PDF de slides enviado para a turma e projetado na sala ao vivo | `Presentation`, `Deck` sozinho | Proposto (SPEC-051) |
| Lâmina | `Slide` | Uma página da apresentação | `Page` | Proposto (SPEC-051) |
| Mão levantada | `LiveHandRaise` (tabela `live_hand_raises`) | Pedido de fala de um estudante na sala ao vivo, em fila cronológica | `Question`, `Request` | Proposto (SPEC-051) |
| Anotações da aula | `LiveClassroomNote` (tabela `live_classroom_notes`) | Caderno privativo do estudante durante a sala ao vivo | `Notes` sozinho | Proposto (SPEC-051) |
| Sala de espera | `LiveClassroomAdmission` (tabela `live_classroom_admissions`) | Situação do estudante numa aula ao vivo (`WAITING`, `ADMITTED`, `REMOVED`): só o aceito pelo professor vê a aula | `Lobby`, `Approval` | Proposto (SPEC-054) |
| Espelho do terminal | `TerminalMirror` | Cópia somente leitura da tela do terminal do professor na aula ao vivo, desenhada pelo aluno a partir de uma árvore segura de tags (`live:terminal:screen`) | `Terminal remoto`, `Replay` | Proposto (SPEC-056) |
| Palco | `FixedStage` | Área fixa de 1920 × 1080 px lógicos onde a aula ao vivo é desenhada, ajustada por escala à janela de cada pessoa, para o professor e os alunos verem a mesma tela | `Viewport`, `Canvas` | Proposto (SPEC-057) |
| Modo foco | `data-focus` da sala do aluno | A sala do aluno cobrindo o menu da plataforma, com o palco na janela inteira, quando o professor liga a tela cheia dos alunos | `Fullscreen` (a tela cheia do navegador é outra coisa) | Proposto (SPEC-059) |
| Dúvida da mão | `question` da mão levantada (`live_hand_raises`) | Texto opcional de até 300 caracteres que o aluno escreve ao levantar a mão; só o professor o lê | `Pergunta`, `Chat` | Proposto (SPEC-058) |
| Aviso (mural) | `Announcement` | Comunicado da docente para a turma | `Notice`, `Post`, `Message` | Canônico |
| Confirmação de leitura | `ReadReceipt` | Registro de ciência do estudante sobre um aviso | `Ack` | Canônico |

## 2.2. Agenda da turma (SPEC-042)

| Português | Código (EN) | Definição | Evitar | Status |
| :--- | :--- | :--- | :--- | :--- |
| Agenda da turma | módulo `schedule` | Encontros, aulas, eventos e períodos de uma turma | `Timetable` | Proposto (SPEC-042) |
| Encontro semanal | `WeeklyMeeting` | Horário fixo da turma num dia da semana, que gera as aulas | `Slot`, `Recurrence` | Proposto (SPEC-042) |
| Aula (sessão de aula) | `ClassSession` | Ocorrência numa data, gerada por um encontro ou avulsa (`origin = EXTRA`) | `Lesson` (reservado a "Módulo de ensino"), `Class` | Proposto (SPEC-042) |
| Evento da turma | `ClassEvent` | Palestra, visita ou atividade informada aos alunos da turma | `Activity` | Proposto (SPEC-042) |
| Período especial | `SpecialPeriod` | Intervalo de dias com aulas suspensas (`NO_CLASSES`) ou online (`ONLINE`) | `Block`, `Break` | Proposto (SPEC-042) |
| Feriado | `Holiday` | Data sem expediente: `NATIONAL`, `LOCAL` ou `RECESS` | `DayOff` | Proposto (SPEC-042) |
| Modalidade da aula | `IN_PERSON`, `ONLINE` | Presencial ou online | `REMOTE`, `VIRTUAL` | Proposto (SPEC-042) |
| Fila de e-mails | `EmailOutbox` | Mensagens a enviar pelo agendador, com novas tentativas | `MailQueue` | Proposto (SPEC-042) |

## 2.1. Autenticação e segurança de acesso

| Português | Código (EN) | Definição | Evitar | Status |
| :--- | :--- | :--- | :--- | :--- |
| Sessão de login | `AuthSession` | Sessão autenticada de um usuário (cookie opaco). Não confundir com tentativa de prova (`Attempt`) | `Session` sozinho, `Login` | Proposto |
| Token de redefinição de senha | `PasswordResetToken` | Token de uso único enviado por e-mail | `ResetCode` | Proposto |
| Token de acesso pessoal | `AccessToken` | Credencial opaca e revogável de um `ADMIN` ou `TEACHER` para o servidor MCP; só o hash é guardado (SPEC-024) | `ApiKey`, `JWT` | Proposto |
| Servidor MCP | `MCP server` | Endpoint `/mcp` do backend com as ferramentas de autoria dos módulos de ensino (SPEC-024) | `Agent API` | Proposto |
| Login OAuth do cliente MCP | `MCP OAuth login` | Fluxo em que o cliente MCP obtém o token de acesso pessoal pelo navegador, com consentimento da docente (SPEC-024 RN-14) | `SSO` | Proposto |
| Log de auditoria de segurança | `SecurityAuditLog` | Registro append-only de eventos de autenticação. Distinto de `SecurityViolation` (infração durante a prova) | `AuthLog`, `AccessLog` | Proposto |

## 3. Conteúdo e banco de questões

| Português | Código (EN) | Definição | Evitar | Status |
| :--- | :--- | :--- | :--- | :--- |
| Material | `StudyMaterial` | Conteúdo didático disponibilizado à turma | `Resource`, `Content`, `File` | Proposto |
| Questão | `Question` | Item avaliável, prático ou teórico | `Item`, `Task`, `Problem` | Canônico |
| Questão prática (laboratório) | `PRACTICAL` (tipo de `Question`) | Desafio no terminal, corrigido de forma determinística pelo estado do VFS | `Lab`, `Hands-on` | Canônico |
| Questão teórica | `THEORETICAL` (tipo de `Question`) | Escolha única, múltipla seleção, booleana ou dissertativa; terminal bloqueado | `Quiz` | Canônico |
| Banco de questões | `QuestionBank` | Acervo reutilizável de questões da docente | `Pool`, `Repository` | Proposto |
| Nível de dificuldade | `DifficultyLevel` | `EASY`, `MEDIUM`, `HARD` | `Level` | Canônico |
| Cenário (base / derivado) | `Scenario` | Receita imutável do estado inicial do VFS; cenários derivados herdam do cenário base | `Environment`, `Setup` | Canônico |
| Solução de referência | `ReferenceSolution` | Sequência de comandos que comprova que a questão é solucionável | `Answer`, `Key` | Proposto |

## 3.1. Conteúdo didático (SPEC-010, SPEC-011)

| Português | Código (EN) | Definição | Evitar | Status |
| :--- | :--- | :--- | :--- | :--- |
| Módulo de ensino | `CourseModule` (módulo de backend `coursemodule`) | Unidade didática com blocos, materiais e questões. Não confundir com "módulo de domínio" do `ARCHITECTURE.md` | `Topic`, `Unit`, `Lesson` | Decidido |
| Bloco | `ContentBlock` | Trecho ordenado do conteúdo de um módulo | `Section`, `Chunk` | Decidido |
| Tipo de bloco | `TEXT`, `COMMAND`, `TIP`, `CURIOSITY`, `STEP_BY_STEP`, `CARDS`, `WIDGET`, `LEGACY_HTML`, `EXERCISES` | Catálogo fechado da SPEC-011, ampliado pela SPEC-022 | — | Decidido |
| Componente interativo | `Widget` (`PERMISSION_CALCULATOR`, `LS_ANATOMY`) | Componente de código referenciado por um bloco | `Plugin` | Decidido |
| Uso da questão | `EXERCISE` (exercício), `ASSESSMENT` (avaliação) | Finalidade da questão; "exercício" é questão com uso `EXERCISE` | — | Decidido (resolve o conflito 2) |
| Condição de validação | `ValidationCondition` | Regra declarativa do catálogo fechado que a correção avalia sobre o estado da máquina | `Check`, `Assertion` | Decidido |
| Motor de correção | `Grader` | Avaliador das condições de validação no servidor | `Corrector`, `Judge` | Decidido |
| Chave de origem | `source_key` | Identificador do item no legado, usado pela carga idempotente | `legacy_id` | Decidido |
| Carga inicial | `seed` | Comando que importa o manifesto do conteúdo para o banco | `import`, `fixture` | Decidido |

## 3.2. Leitura em voz alta (SPEC-017)

| Português | Código (EN) | Definição | Evitar | Status |
| :--- | :--- | :--- | :--- | :--- |
| Síntese de fala | `SpeechSynthesis` | Resultado de converter um texto em áudio falado, com as marcas de palavra | `TTSResult`, `Audio` sozinho | Decidido |
| Marca de palavra | `WordTiming` | Instante inicial e final, em milissegundos, de uma palavra no áudio | `WordBoundary` (termo do provedor, fica restrito ao adaptador), `Timestamp` | Decidido |
| Voz | `Voice` | Voz neural escolhida de uma lista fechada (`pt-BR-FranciscaNeural`, `pt-BR-AntonioNeural`) | `Speaker`, `Narrator` | Decidido |
| Narração | `Narration` | Leitura em voz alta, com destaque palavra a palavra, do material de um card (SPEC-018) | `Karaoke`, `Playback` | Proposto |
| Grupo de exercícios | `ExerciseGroup` | Lista ordenada de exercícios de um card, guardada num bloco `EXERCISES`, com um snapshot opcional que é o estado base da máquina antes deles (SPEC-022) | — | Proposto |
| Exercício do card | `CardExercise` | Atividade do grupo, com título, dificuldade (`EASY`, `MEDIUM`, `HARD`), descrição, dicas, a solução gravada pela docente e as condições de finalização. Não é uma `Question` e não vale nota | Exercício | Proposto |
| Exercício do módulo | `ModuleExercise` | Exercício do banco do módulo: uma `Question` prática, com enunciado, nível, dicas, solução gravada pela docente e condições de finalização (SPEC-023) | Exercício | Proposto |
| Banco de exercícios do módulo (na interface, "Banco de questões do módulo") | `ModuleExerciseBank` | Conjunto das questões de um módulo, de qualquer tipo aceito (SPEC-035 D-05), nos dois conjuntos abaixo; é o `QuestionBank` restrito ao módulo (SPEC-023) | Pool | Proposto |
| Vínculo do exercício | `ExerciseLinks` | Onde um exercício do banco está ligado: à prática do módulo (`practice`, na trilha), à avaliação (`assessment`) ou aos dois; `exclusive` o reserva só à avaliação. O banco é único e o snapshot é um só (`bank_setup`) (SPEC-023) | Conjunto, lista | Proposto |
| Dependência entre exercícios | `ExerciseDependency` | Um exercício (`depends_on`) cuja solução gravada é montada antes de outro; forma uma cadeia. O sistema só sugere, a docente confirma (SPEC-023 12.3) | Continua do anterior | Proposto |
| Teste do banco | `BankTest` | Esteira de validação do banco: ambiente consolidado, ordem linear, ordem reversa e rodadas sorteadas, com relatório e sugestões de dependência (SPEC-023 12) | — | Proposto |
| Condição de finalização | `CompletionCondition` | Algo que precisa valer na máquina ao fim do exercício (pasta existe, arquivo tem o texto, permissão, dono, usuário...), seja qual for a forma como o estudante chegou lá (SPEC-022) | — | Proposto |
| Tipo de questão | `QuestionKind` (coluna `kind`) | O que a questão é e como o aluno responde. No banco do módulo e nos exercícios do card: `PRACTICAL` ("Comando Linux"), `THEORETICAL_BOOLEAN` ("Verdadeiro ou falso", SPEC-035) e `THEORETICAL_SINGLE` ("Escolha única", SPEC-036) e `THEORETICAL_MATCHING` ("Ligar colunas", SPEC-037); só no banco do módulo, `DISCURSIVE` ("Descritiva", SPEC-039); os demais valores esperam spec própria | Tipo de exercício | Decidido |
| Questão de verdadeiro ou falso | `THEORETICAL_BOOLEAN` | Uma afirmação que o aluno marca como verdadeira ou falsa, sem terminal; no exercício a resposta é única e travada, na avaliação pode mudar até finalizar (SPEC-035) | Booleana, V/F | Decidido |
| Questão de escolha única | `THEORETICAL_SINGLE` | De 2 a 7 alternativas escritas no editor, das quais só uma é correta; embaralhadas para o aluno ou na ordem da docente, conforme a questão; mesmo comportamento do verdadeiro ou falso no exercício e na avaliação (SPEC-036) | Múltipla escolha (é outro tipo), quiz | Decidido |
| Alternativa | `Choice` (campo `choices`) | Uma opção da questão de escolha única: identificador estável e conteúdo em HTML (SPEC-036 D-01, D-02) | Opção, item | Decidido |
| Alternativa correta | `correctChoice` | O identificador da única alternativa correta; o gabarito nunca é a posição (SPEC-036 D-01) | — | Decidido |
| Embaralhar alternativas | `shuffleChoices` | Opção da questão: mostrar as alternativas (ou as colunas, na de ligar colunas) numa ordem diferente a cada vez (padrão) ou manter a ordem da docente (SPEC-036 D-07, SPEC-037 D-10) | `randomize` | Decidido |
| Questão de ligar colunas | `THEORETICAL_MATCHING` | Duas colunas de 2 a 5 itens montadas pela docente, cada uma na sua ordem; ela seleciona o par correto de cada item da esquerda e o aluno liga os itens (SPEC-037) | Associação, relacionar colunas | Decidido |
| Par | `Pair` (campo `pairs`) | A ligação correta entre um item da esquerda e um da direita, pelos identificadores (SPEC-037 D-08, D-09) | — | Decidido |
| Ligação | `Link` (campo `links` da resposta) | A ligação que o aluno faz entre um item de cada coluna (SPEC-037 D-08) | — | Decidido |
| Questão descritiva | `DISCURSIVE` | O aluno escreve a resposta com texto e comandos, enviada uma vez; uma IA pode sugerir a nota pelo MCP e a docente dá a nota final. Só no banco do módulo, não nos exercícios do card (SPEC-039 D-01, D-09) | Dissertativa, discursiva | Decidido |
| Resposta correta (da descritiva) | `expectedAnswer` | Texto opcional da docente que orienta a correção e a IA; no exercício o aluno a vê depois de enviar, na avaliação só no resultado (SPEC-039 D-03) | Gabarito | Decidido |
| Tamanho máximo da resposta | `maxLength` | Limite de caracteres de texto da resposta descritiva, escolhido pela docente: 500, 1000, 2000 (padrão), 5000 ou 10000 (SPEC-039 D-05) | — | Decidido |
| Sugestão de nota | `GradeSuggestion` (campos `suggested_*` de `answer_grades`) | Nota (uma das faixas), justificativa e anotação para o aluno que um agente de IA grava pelo MCP; nunca vale sozinha nem aparece para o aluno (SPEC-039 RN-04) | Nota da IA | Decidido |
| Nota da resposta | `AnswerGrade` (tabela `answer_grades`) | A porcentagem de acerto que a docente confirma numa resposta descritiva, em faixas de 0, 25, 50, 75 ou 100, com a origem (`AI_ACCEPTED`, sugestão aceita, ou `TEACHER`); toda confirmação e revisão fica em `answer_grade_events`, que não se apaga (SPEC-039 RN-05, RN-06) | Pontuação | Decidido |
| Anotação para o aluno | `studentNote` | Texto da docente para o aluno, mostrado com a nota; a IA pode sugerir (SPEC-039 D-06) | Comentário, feedback | Decidido |
| Anotação privada | `privateNote` | Texto da docente sobre a resposta que o aluno nunca vê (SPEC-039 D-06) | — | Decidido |
| Resposta do estudante | `response` | A escolha do aluno numa questão sem terminal (para verdadeiro ou falso, `value` booleano); no exercício, gravada uma única vez em `exercise_progress.response` (SPEC-035 RN-08) | `answer` (reservado ao gabarito) | Decidido |
| Justificativa | `explanation` | Texto da docente que explica a resposta correta, mostrado ao aluno depois de responder (no exercício) ou no resultado (na avaliação) (SPEC-035) | — | Decidido |
| Trecho de narração | `NarrationChunk` | Parte de até 2000 caracteres de um bloco, com o áudio e as marcas de palavra | `Segment`, `Part` | Proposto |

## 3.3. Conformidade do motor (SPEC-030)

| Português | Código (EN) | Definição | Evitar | Status |
| :--- | :--- | :--- | :--- | :--- |
| Verificação de conformidade | `EngineConformance` | Execução, pelo administrador e no navegador, de todos os comandos e programas do motor, para conferir se o simulador está íntegro (SPEC-030) | `HealthCheck` | Proposto |
| Manifesto de conformidade | `ConformanceManifest` | Lista única com uma verificação (item) por comando e por programa; um teste do repositório falha se divergir do catálogo real | `Checklist` | Proposto |
| Programa (do motor) | `EngineProgram` | Executável em pasta do `PATH` da máquina padrão que não é comando do catálogo, ou que um pacote do `apt` simulado oferece | — | Proposto |
| Suíte de conformidade | `ConformanceSuite` | Os casos de teste de um comando ou programa, que rodam em ordem na mesma máquina; a verificação tem uma por comando e por programa (SPEC-030) | `TestSet` | Proposto |
| Caso de conformidade | `ConformanceCase` | Uma linha digitada no terminal com o que se espera dela (código de saída e trecho da saída) (SPEC-030) | `TestCase` (já é de outro assunto) | Proposto |

## 4. Avaliações e aplicação

| Português | Código (EN) | Definição | Evitar | Status |
| :--- | :--- | :--- | :--- | :--- |
| Modelo de avaliação (de prova ou atividade) | `AssessmentTemplate` | Estrutura reutilizável: regras de sorteio, pesos e duração, sem turma nem data | `Blueprint`, `ExamModel` | Proposto |
| Avaliação | `Assessment` | Instância avaliativa vinculada a uma turma | `Evaluation`, `Test` | Canônico |
| Prova | `EXAM` (tipo de `Assessment`) | Somativa, síncrona, cronometrada, presencial, com token de sala | `Test` | Canônico |
| Atividade | `ASSIGNMENT` (tipo de `Assessment`) | Lista assíncrona com prazo em dias, sem token e sem telemetria síncrona | `Homework`, `Task` | Canônico |
| Regra de sorteio | `DrawRule` | Percentual e pontuação uniforme por nível de dificuldade | `RandomRule` | Canônico |
| Janela de aplicação | `AssessmentWindow` | Período em que a avaliação pode ser feita | `Slot`, `Schedule` | Canônico |
| Tipo de janela | `REGULAR`, `RETAKE` (repescagem), `MAKEUP` (segunda chamada), `FREE_PRACTICE` (treino livre) | — | — | Canônico |
| Token de liberação | `UnlockCode` | Código que a docente projeta em sala para liberar a prova | `Token` sozinho (confunde com token de autenticação), `Password` | Proposto |
| Tentativa (sessão de avaliação) | `Attempt` | Execução de uma avaliação por um estudante em uma janela | `Session` (confunde com sessão de login e com o `Sessao` do legado), `Try` | Proposto |
| Submissão de questão | `QuestionSubmission` | Resultado e telemetria de uma questão em uma tentativa | `Answer` | Canônico |
| Snapshot do VFS | `VfsSnapshot` | Estado serializado do sistema de arquivos virtual enviado para correção | `Dump` | Canônico |
| Log de comandos | `CommandLog` | Sequência cronológica de comandos executados | `History` | Canônico |
| Pacote de contingência | `ContingencyProof` (arquivo `.proof`) | Envelope cifrado para entrega offline | `Backup` | Canônico |

## 5. Condução da prova e auditoria

| Português | Código (EN) | Definição | Evitar | Status |
| :--- | :--- | :--- | :--- | :--- |
| Cockpit | `Cockpit` | Painel de acompanhamento da docente durante a prova | `Dashboard`, `Monitor` | Canônico |
| Bloqueio (cautelar) | `lock` → status `LOCKED` | Pausa reversível da tentativa | `pause`, `freeze` | Proposto (ver conflito 1) |
| Reabertura | `reopen` → status `IN_PROGRESS` | Reversão do bloqueio, com compensação de tempo | `resume`, `unlock` | Proposto (ver conflito 1) |
| Compensação de tempo | `TimeCompensation` | Segundos acrescidos ao prazo após a reabertura | `Extension` | Canônico |
| Encerramento | `close` → status `CLOSED_BY_TEACHER` | Finalização antecipada; a nota é calculada normalmente | `finish`, `end`, `kill` | Proposto (ver conflito 1) |
| Anulação | `annul` → status `ANNULLED` | Deliberação disciplinar pós-prova; nota zero | `cancel`, `void`, `invalidate` | Proposto (ver conflito 1) |
| Homologação de nota | `GradeApproval` | Confirmação docente da nota final, com justificativa quando difere da nota automática | `ratify`, `confirm` | Canônico |
| Nota automática (bruta) | `auto_score` | Pontuação emitida pelo corretor do servidor | `raw_grade` | Canônico |
| Nota final homologada | `final_grade` | Nota definitiva após revisão docente | `score` | Canônico |
| Resultado | `Result` | Consolidação de notas por estudante e por avaliação | `Report`, `Outcome` | Proposto |
| Observação docente | `ProctorNote` | Registro presencial da docente sobre a tentativa | `Comment`, `Remark` | Canônico |
| Evento da linha do tempo | `TimelineEvent` | Registro cronológico de auditoria da tentativa | `Log`, `Activity` | Canônico |
| Infração de segurança | `SecurityViolation` | Detecção de DevTools, aba oculta, conflito de sessão ou IP fora da sub-rede | `Infraction`, `Cheat` | Canônico |
| Pedido de ajuda ("mãozinha virtual") | `HelpRequest` / fila `HelpQueue` | Dúvida do estudante durante a prova, atendida em fila FIFO | `Ticket`, `Support` | Canônico |

## 6. Conflitos conhecidos nas fontes canônicas

Divergências encontradas em `docs/arquitetura/transicao-backend.md`. Nenhuma spec que dependa delas pode ser aprovada antes de resolvê-las:

1. **Status da tentativa:** a seção 3.1 lista `EM_ANDAMENTO`, `FINALIZADO`, `TEMPO_ESGOTADO`, `CANCELADO` e `BLOQUEADO_DOCENTE`; a seção 6.4 usa `BLOQUEADO_CAUTELAR`, `ENCERRADO_DOCENTE`, `CONCLUIDO` e `ANULADO_DISCIPLINAR`. É preciso definir a lista final.
2. ~~**Exercício × Questão**~~ — resolvido em 08/10/2026 (SPEC-011): tudo é `Question`; exercício é o uso `EXERCISE`.
3. **Modelo de avaliação:** o documento canônico vincula `Avaliacao` direto à turma e não prevê modelos reutilizáveis. `AssessmentTemplate` é proposta nova.
