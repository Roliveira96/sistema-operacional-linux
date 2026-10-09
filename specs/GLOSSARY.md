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
| Matrícula (inscrição na turma) | `Enrollment` | Vínculo de um estudante com uma turma e o ciclo de vida desse vínculo | `Registration`, `Subscription`, `Inscription` | Canônico |
| Status da matrícula | `PENDING_MODERATION`, `ACTIVE`, `REJECTED`, `TRANSFERRED`, `UNENROLLED` | Ciclo de vida do vínculo com a turma | `PENDING`, `APPROVED`, `REMOVED` | Decidido (`REJECTED` e `UNENROLLED` propostos na SPEC-002) |
| Origem da matrícula | `INVITE_LINK`, `CSV_IMPORT`, `DIRECT_BY_TEACHER` | Por qual via o estudante entrou na turma | — | Canônico |
| Pré-matrícula | `PRE_ENROLLED` (status) | Estudante importado da lista que ainda não ativou a conta | — | Canônico; uso em discussão (SPEC-002, P-10) |
| Moderação (deferir / indeferir) | `approve` / `reject` | Decisão docente sobre um pedido de matrícula feito por link | `accept`, `deny` | Canônico |
| Remanejamento | `Transfer` | Mudança do estudante de uma turma para outra, com rastreabilidade | `Move`, `Migration` | Canônico |
| Link de convite | `InviteLink` | URL compartilhável para pedir matrícula na turma | `JoinLink` | Canônico |
| Aviso (mural) | `Announcement` | Comunicado da docente para a turma | `Notice`, `Post`, `Message` | Canônico |
| Confirmação de leitura | `ReadReceipt` | Registro de ciência do estudante sobre um aviso | `Ack` | Canônico |

## 2.1. Autenticação e segurança de acesso

| Português | Código (EN) | Definição | Evitar | Status |
| :--- | :--- | :--- | :--- | :--- |
| Sessão de login | `AuthSession` | Sessão autenticada de um usuário (cookie opaco). Não confundir com tentativa de prova (`Attempt`) | `Session` sozinho, `Login` | Proposto |
| Token de redefinição de senha | `PasswordResetToken` | Token de uso único enviado por e-mail | `ResetCode` | Proposto |
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
| Tipo de bloco | `TEXT`, `COMMAND`, `TIP`, `CURIOSITY`, `STEP_BY_STEP`, `CARDS`, `WIDGET`, `LEGACY_HTML` | Catálogo fechado da SPEC-011 | — | Decidido |
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
| Trecho de narração | `NarrationChunk` | Parte de até 2000 caracteres de um bloco, com o áudio e as marcas de palavra | `Segment`, `Part` | Proposto |

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
