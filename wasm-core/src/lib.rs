use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use wasm_bindgen::prelude::*;

const O2_MAX_VALUE: f64 = 180_000.0;
const H2O_MAX_VALUE: f64 = 1_000.0;
const ENG_MAX_VALUE: f64 = 250.0;
const ENGINE_SAVE_SCHEMA: &str = "aliya-web.engine-save";
const ENGINE_SAVE_VERSION: u32 = 5;
const INTERACTION_TOGGLE_SECONDS: f64 = 0.55;

#[derive(Debug, Deserialize)]
struct FlowchartsDocument {
    #[serde(default, rename = "dailyInsertConfigs")]
    daily_insert_configs: Vec<DailyInsertConfig>,
    flowcharts: HashMap<String, Flowchart>,
}

#[derive(Debug, Deserialize)]
struct Flowchart {
    #[serde(default)]
    variables: Vec<VariableDefinition>,
    blocks: HashMap<String, Block>,
}

#[derive(Debug, Deserialize, Clone)]
struct VariableDefinition {
    key: String,
    #[serde(rename = "type")]
    variable_type: String,
    #[serde(default, rename = "scopeName")]
    scope_name: String,
    #[serde(default, rename = "defaultValue")]
    default_value: Value,
}

#[derive(Debug, Deserialize)]
struct Block {
    commands: Vec<Command>,
}

#[derive(Debug, Deserialize, Clone)]
struct Command {
    #[serde(rename = "type")]
    command_type: String,
    #[serde(default, rename = "itemId")]
    item_id: Option<i64>,
    #[serde(default, rename = "indentLevel")]
    indent_level: i32,
    #[serde(default, rename = "stringId")]
    string_id: Option<String>,
    #[serde(default)]
    fields: Value,
}

#[derive(Debug, Deserialize)]
struct LocalizationTable(HashMap<String, String>);

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DailyInsertConfig {
    min_month: i32,
    min_day: i32,
    max_month: i32,
    max_day: i32,
    min_hour: i32,
    min_minute: i32,
    max_hour: i32,
    max_minute: i32,
    flowchart_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineEvent {
    event_type: String,
    source: Option<String>,
    text: Option<String>,
    string_id: Option<String>,
    text_index: Option<usize>,
    image_id: Option<String>,
    choices: Option<Vec<ChoiceEvent>>,
    seconds: Option<f64>,
    audio_id: Option<String>,
    audio: Option<AudioState>,
    resources: Option<ResourceState>,
    interactions: Option<InteractionState>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChoiceEvent {
    id: String,
    text: String,
    string_id: Option<String>,
    reply_text: Option<String>,
    reply_image_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ResourceState {
    o2_percent: f64,
    h2o_percent: f64,
    eng_percent: f64,
    heart_rate: i32,
    o2_consume_factor: f64,
    eog_is_on: bool,
    game_has_over: bool,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InteractionState {
    eog_can_interact: bool,
    eh_can_interact: bool,
    radio_can_interact: bool,
    eog_is_on: bool,
    eh_is_open: bool,
    radio_is_open: bool,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioState {
    bgm_id: String,
    radio_music_id: Option<String>,
    radio_music_enabled: bool,
    bgm_volume: f64,
    radio_volume: f64,
    sound_volume: f64,
    radio_pin_pos: f64,
    radio_pin_final_pos: Option<f64>,
    radio_quality_per_pos_percent: f64,
    radio_music_volume_percent: f64,
    radio_noise_volume_percent: f64,
    all_radio_audio_volume_percent: f64,
    bgm_audio_volume_percent: f64,
    bgm_fade_seconds: f64,
}

#[wasm_bindgen]
pub struct AliyaEngine {
    flowcharts: FlowchartsDocument,
    localization: HashMap<String, String>,
    current_flowchart: String,
    current_block: String,
    current_index: usize,
    pending_choices: Vec<PendingChoiceState>,
    pending_default_block: Option<String>,
    pending_default_seconds: Option<f64>,
    pending_default_preserves_choices: bool,
    waiting: bool,
    public_variables: HashMap<String, Value>,
    private_variables: HashMap<String, HashMap<String, Value>>,
    default_variables: HashMap<String, HashMap<String, Value>>,
    debug_variable_seeds: HashMap<String, Value>,
    debug_interaction_seeds: HashMap<InteractionControl, InteractionSeedState>,
    pending_invisible_choices: Vec<InvisibleChoiceState>,
    pending_input: Option<InputRequestState>,
    interactions: InteractionState,
    achievements: HashSet<String>,
    o2_run_out_flowchart: String,
    o2_hazard_enabled: bool,
    highlighted_button: Option<i32>,
    warning_animation: bool,
    player_can_skip: bool,
    unity_messages: Vec<UnityMessageState>,
    daily: DailyState,
    resources: ResourceState,
    heart_rate_monitor_on: bool,
    audio: AudioState,
    pending_interactions: Vec<PendingInteractionState>,
    clock_override_ms: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PendingChoiceState {
    choice: ChoiceEvent,
    target_block: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct InvisibleChoiceState {
    rule: i32,
    target_block: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct InputRequestState {
    variable_key: String,
    send_message: bool,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PendingInteractionState {
    control: InteractionControl,
    remaining_seconds: f64,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
enum InteractionControl {
    Eog,
    Eh,
    Radio,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InteractionSeedState {
    is_open: bool,
    can_interact: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UnityMessageState {
    flowchart: String,
    block: String,
    item_id: Option<i64>,
    message_target: i32,
    message: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineSaveEnvelope {
    schema: String,
    version: u32,
    saved_at_ms: f64,
    content: ContentSnapshot,
    snapshot: EngineSnapshot,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContentSnapshot {
    flowchart_count: usize,
    block_count: usize,
    daily_insert_count: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineSnapshot {
    navigation: NavigationSnapshot,
    pending: PendingSnapshot,
    variables: VariablesSnapshot,
    resources: ResourceState,
    audio: AudioState,
    interactions: InteractionState,
    achievements: Vec<String>,
    systems: SystemsSnapshot,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NavigationSnapshot {
    flowchart: String,
    block: String,
    index: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingSnapshot {
    choices: Vec<PendingChoiceState>,
    default_block: Option<String>,
    default_seconds: Option<f64>,
    default_preserves_choices: bool,
    waiting: bool,
    invisible_choices: Vec<InvisibleChoiceState>,
    input: Option<InputRequestState>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct VariablesSnapshot {
    public: HashMap<String, Value>,
    private: HashMap<String, HashMap<String, Value>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemsSnapshot {
    o2_run_out_flowchart: String,
    o2_hazard_enabled: bool,
    highlighted_button: Option<i32>,
    warning_animation: bool,
    player_can_skip: bool,
    heart_rate_monitor_on: bool,
    #[serde(default)]
    unity_messages: Vec<UnityMessageState>,
    daily: DailyState,
    pending_interactions: Vec<PendingInteractionState>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DailyState {
    undergoing: bool,
    waiting: bool,
    in_insert: bool,
    saved_position: Option<FlowchartPosition>,
    triggered_inserts: Vec<String>,
    need_new_day_mark_command: Option<String>,
    need_new_day_mark_time_ms: Option<f64>,
    insert_check_accumulator: f64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FlowchartPosition {
    flowchart: String,
    block: String,
    index: usize,
}

#[wasm_bindgen]
impl AliyaEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(flowcharts_json: &str, localization_json: &str) -> Result<AliyaEngine, JsValue> {
        let flowcharts: FlowchartsDocument = serde_json::from_str(flowcharts_json)
            .map_err(|err| JsValue::from_str(&format!("flowcharts parse failed: {err}")))?;
        let localization: HashMap<String, String> = serde_json::from_str(localization_json)
            .or_else(|_| {
                serde_json::from_str::<LocalizationTable>(localization_json).map(|table| table.0)
            })
            .map_err(|err| JsValue::from_str(&format!("localization parse failed: {err}")))?;
        let (public_variables, private_variables, default_variables) =
            initial_variables(&flowcharts);

        Ok(AliyaEngine {
            flowcharts,
            localization,
            current_flowchart: "1-1".to_string(),
            current_block: "1-1".to_string(),
            current_index: 0,
            pending_choices: Vec::new(),
            pending_default_block: None,
            pending_default_seconds: None,
            pending_default_preserves_choices: false,
            waiting: false,
            public_variables,
            private_variables,
            default_variables,
            debug_variable_seeds: HashMap::new(),
            debug_interaction_seeds: HashMap::new(),
            pending_invisible_choices: Vec::new(),
            pending_input: None,
            interactions: default_interactions(),
            achievements: HashSet::new(),
            o2_run_out_flowchart: "O2RunOut".to_string(),
            o2_hazard_enabled: true,
            highlighted_button: None,
            warning_animation: false,
            player_can_skip: true,
            unity_messages: Vec::new(),
            daily: default_daily_state(),
            resources: ResourceState {
                o2_percent: 0.3,
                h2o_percent: 0.1,
                eng_percent: 0.4,
                heart_rate: 60,
                o2_consume_factor: 1.0,
                eog_is_on: false,
                game_has_over: false,
            },
            heart_rate_monitor_on: false,
            audio: default_audio_state(),
            pending_interactions: Vec::new(),
            clock_override_ms: None,
        })
    }

    pub fn start(&mut self) -> String {
        let achievements = self.achievements.clone();
        self.current_flowchart = "1-1".to_string();
        self.current_block = "1-1".to_string();
        self.current_index = 0;
        self.reset_runtime_state();
        self.achievements = achievements;
        self.run_until_halt()
    }

    pub fn choose(&mut self, choice_id: &str) -> String {
        let Some(index) = self
            .pending_choices
            .iter()
            .position(|pending| pending.choice.id == choice_id)
        else {
            return serialize_events(vec![EngineEvent::system(format!(
                "Unknown choice: {choice_id}"
            ))]);
        };
        let pending = self.pending_choices.remove(index);
        self.pending_choices.clear();
        self.pending_default_block = None;
        self.pending_default_seconds = None;
        self.pending_default_preserves_choices = false;
        self.waiting = false;
        self.daily.waiting = false;
        self.pending_invisible_choices.clear();
        self.pending_input = None;
        self.current_block = pending.target_block;
        self.current_index = 0;

        let mut events = vec![player_reply_event(pending.choice)];
        events.extend(self.run_collect());
        serialize_events(events)
    }

    pub fn interact(&mut self, control: &str) -> String {
        let control = match control {
            "eog" | "EOG" => {
                if !self.interactions.eog_can_interact {
                    return serialize_events(vec![
                        interactions_event(self.interactions.clone()),
                        audio_state_event(self.audio.clone()),
                    ]);
                }
                InteractionControl::Eog
            }
            "eh" | "EH" => {
                if !self.interactions.eh_can_interact {
                    return serialize_events(vec![
                        interactions_event(self.interactions.clone()),
                        audio_state_event(self.audio.clone()),
                    ]);
                }
                InteractionControl::Eh
            }
            "radio" | "RAD" | "Radio" => {
                if !self.interactions.radio_can_interact {
                    return serialize_events(vec![
                        interactions_event(self.interactions.clone()),
                        audio_state_event(self.audio.clone()),
                    ]);
                }
                InteractionControl::Radio
            }
            _ => {
                return serialize_events(vec![EngineEvent::system(format!(
                    "Unknown interaction: {control}"
                ))]);
            }
        };
        let rule = interaction_rule(&control);

        self.queue_interaction_completion(control);
        let mut events = Vec::new();
        if let Some(index) = self
            .pending_invisible_choices
            .iter()
            .position(|choice| choice.rule == rule)
        {
            let target_block = self.pending_invisible_choices.remove(index).target_block;
            self.pending_invisible_choices.clear();
            self.pending_choices.clear();
            self.pending_input = None;
            self.pending_default_block = None;
            self.pending_default_seconds = None;
            self.pending_default_preserves_choices = false;
            self.waiting = false;
            self.daily.waiting = false;
            self.current_block = target_block;
            self.current_index = 0;
            events.extend(self.run_collect());
        }
        if events.is_empty() {
            events.push(interactions_event(self.interactions.clone()));
            events.push(audio_state_event(self.audio.clone()));
        }
        serialize_events(events)
    }

    pub fn debug_complete_interaction(&mut self, control: &str) -> String {
        let Some(control) = parse_interaction_control(control) else {
            return serialize_events(vec![EngineEvent::system(format!(
                "Unknown interaction: {control}"
            ))]);
        };
        self.pending_interactions
            .retain(|pending| pending.control != control);
        let mut events = Vec::new();
        self.complete_interaction(control, &mut events);
        serialize_events(events)
    }

    pub fn tune_radio(&mut self, percent: f64) -> String {
        self.audio.radio_pin_pos = percent.clamp(0.0, 1.0);
        self.update_radio_tuning();
        serialize_events(vec![audio_state_event(self.audio.clone())])
    }

    pub fn debug_jump_to(&mut self, flowchart: &str, block: &str) -> String {
        self.debug_jump_to_index(flowchart, block, 0)
    }

    pub fn debug_jump_to_index(&mut self, flowchart: &str, block: &str, index: usize) -> String {
        self.debug_jump_to_index_with_daily_insert_context(flowchart, block, index, false)
    }

    pub fn debug_jump_daily_insert_to_index(
        &mut self,
        flowchart: &str,
        block: &str,
        index: usize,
    ) -> String {
        self.debug_jump_to_index_with_daily_insert_context(flowchart, block, index, true)
    }

    fn debug_jump_to_index_with_daily_insert_context(
        &mut self,
        flowchart: &str,
        block: &str,
        index: usize,
        daily_insert_context: bool,
    ) -> String {
        let Some(target_flowchart) = self.flowcharts.flowcharts.get(flowchart) else {
            return serialize_events(vec![EngineEvent::system(format!(
                "Debug jump flowchart not found: {flowchart}"
            ))]);
        };
        let Some(target_block) = target_flowchart.blocks.get(block) else {
            return serialize_events(vec![EngineEvent::system(format!(
                "Debug jump block not found: {flowchart}/{block}"
            ))]);
        };
        if index > target_block.commands.len() {
            return serialize_events(vec![EngineEvent::system(format!(
                "Debug jump command index out of range: {flowchart}/{block}@{index}"
            ))]);
        }
        let target_block_len = target_block.commands.len();

        let achievements = self.achievements.clone();
        self.reset_runtime_state();
        self.achievements = achievements;
        self.current_flowchart = flowchart.to_string();
        self.current_block = block.to_string();
        self.current_index = index;
        self.apply_debug_interaction_seeds();
        self.apply_debug_variable_seeds();
        if daily_insert_context {
            self.daily.undergoing = true;
            self.daily.in_insert = true;
            self.daily.waiting = false;
            self.daily.saved_position = Some(FlowchartPosition {
                flowchart: flowchart.to_string(),
                block: block.to_string(),
                index: target_block_len,
            });
            self.daily.triggered_inserts.push(flowchart.to_string());
        }
        self.run_until_halt()
    }

    pub fn debug_set_achievement(&mut self, achievement_id: &str, value: bool) {
        if value {
            self.achievements.insert(achievement_id.to_string());
        } else {
            self.achievements.remove(achievement_id);
        }
    }

    pub fn debug_set_variable(&mut self, key: &str, variable_type: &str, value: &str) {
        let raw_value = match variable_type {
            "bool" | "boolean" => json!(matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "y" | "on"
            )),
            "int" | "integer" => json!(value.trim().parse::<i64>().unwrap_or(0)),
            "float" | "single" => json!(value.trim().parse::<f64>().unwrap_or(0.0)),
            "string" => json!(value),
            _ => json!(value),
        };
        self.debug_variable_seeds
            .insert(key.to_string(), coerce_value(raw_value, variable_type));
        self.apply_debug_variable_seeds();
    }

    pub fn debug_set_interaction_seed(
        &mut self,
        control: &str,
        is_open: bool,
        can_interact: Option<bool>,
    ) {
        let Some(control) = parse_interaction_control(control) else {
            return;
        };
        self.debug_interaction_seeds.insert(
            control,
            InteractionSeedState {
                is_open,
                can_interact,
            },
        );
        self.apply_debug_interaction_seeds();
    }

    pub fn submit_input(&mut self, text: &str) -> String {
        let Some(input) = self.pending_input.take() else {
            return serialize_events(vec![EngineEvent::system(
                "No player input is currently required.",
            )]);
        };
        self.public_variables
            .insert(input.variable_key, json!(text.to_string()));

        let mut events = Vec::new();
        if input.send_message {
            events.push(EngineEvent {
                event_type: "message".to_string(),
                source: Some("player".to_string()),
                text: Some(text.to_string()),
                string_id: None,
                text_index: None,
                image_id: None,
                choices: None,
                seconds: None,
                audio_id: None,
                audio: None,
                resources: None,
                interactions: None,
            });
        }
        events.extend(self.run_collect());
        serialize_events(events)
    }

    pub fn continue_after_wait(&mut self) -> String {
        self.waiting = false;
        if !self.pending_default_preserves_choices {
            self.pending_choices.clear();
        }
        self.pending_invisible_choices.clear();
        self.pending_input = None;
        self.pending_default_seconds = None;
        self.pending_default_preserves_choices = false;
        self.daily.waiting = false;
        if let Some(target_block) = self.pending_default_block.take() {
            self.current_block = target_block;
            self.current_index = 0;
        }
        self.run_until_halt()
    }

    pub fn tick(&mut self, seconds: f64) -> String {
        let was_over = self.resources.game_has_over;
        self.advance_clock(seconds);
        self.update_resources(seconds);
        let mut events = vec![EngineEvent {
            event_type: "resources".to_string(),
            source: None,
            text: None,
            string_id: None,
            text_index: None,
            image_id: None,
            choices: None,
            seconds: None,
            audio_id: None,
            audio: None,
            resources: Some(self.resources.clone()),
            interactions: None,
        }];
        if !was_over && self.resources.game_has_over && self.o2_hazard_enabled {
            events.extend(self.run_collect());
        } else if self.daily.undergoing
            && self.daily.waiting
            && !self.daily.in_insert
            && self.waiting
        {
            self.daily.insert_check_accumulator += seconds.max(0.0);
            if self.daily.insert_check_accumulator >= 5.0 {
                self.daily.insert_check_accumulator = 0.0;
                self.try_trigger_daily_insert(&mut events);
            }
        }
        self.update_pending_interactions(seconds, &mut events);
        serialize_events(events)
    }

    pub fn state_json(&self) -> String {
        serde_json::to_string(&json!({
            "flowchart": self.current_flowchart,
            "block": self.current_block,
            "index": self.current_index,
            "resources": self.resources,
            "variables": self.public_variables,
            "interactions": self.interactions,
            "achievements": self.achievements,
            "o2RunOutFlowchart": self.o2_run_out_flowchart,
            "o2HazardEnabled": self.o2_hazard_enabled,
            "highlightedButton": self.highlighted_button,
            "warningAnimation": self.warning_animation,
            "playerCanSkip": self.player_can_skip,
            "heartRateMonitorOn": self.heart_rate_monitor_on,
            "unityMessages": self.unity_messages,
            "audio": self.audio,
            "pendingInteractions": self.pending_interactions,
            "pending": {
                "choices": self.pending_choices,
                "defaultBlock": self.pending_default_block,
                "defaultSeconds": self.pending_default_seconds,
                "defaultPreservesChoices": self.pending_default_preserves_choices,
                "waiting": self.waiting,
                "invisibleChoices": self.pending_invisible_choices,
                "input": self.pending_input,
            },
            "daily": self.daily,
        }))
        .unwrap_or_else(|_| "{}".to_string())
    }

    pub fn save_json(&self) -> String {
        let mut achievements: Vec<String> = self.achievements.iter().cloned().collect();
        achievements.sort();
        serde_json::to_string(&EngineSaveEnvelope {
            schema: ENGINE_SAVE_SCHEMA.to_string(),
            version: ENGINE_SAVE_VERSION,
            saved_at_ms: now_ms(),
            content: ContentSnapshot {
                flowchart_count: self.flowcharts.flowcharts.len(),
                block_count: self
                    .flowcharts
                    .flowcharts
                    .values()
                    .map(|flowchart| flowchart.blocks.len())
                    .sum(),
                daily_insert_count: self.flowcharts.daily_insert_configs.len(),
            },
            snapshot: EngineSnapshot {
                navigation: NavigationSnapshot {
                    flowchart: self.current_flowchart.clone(),
                    block: self.current_block.clone(),
                    index: self.current_index,
                },
                pending: PendingSnapshot {
                    choices: self.pending_choices.clone(),
                    default_block: self.pending_default_block.clone(),
                    default_seconds: self.pending_default_seconds,
                    default_preserves_choices: self.pending_default_preserves_choices,
                    waiting: self.waiting,
                    invisible_choices: self.pending_invisible_choices.clone(),
                    input: self.pending_input.clone(),
                },
                variables: VariablesSnapshot {
                    public: self.public_variables.clone(),
                    private: self.private_variables.clone(),
                },
                resources: self.resources.clone(),
                audio: self.audio.clone(),
                interactions: self.interactions.clone(),
                achievements,
                systems: SystemsSnapshot {
                    o2_run_out_flowchart: self.o2_run_out_flowchart.clone(),
                    o2_hazard_enabled: self.o2_hazard_enabled,
                    highlighted_button: self.highlighted_button,
                    warning_animation: self.warning_animation,
                    player_can_skip: self.player_can_skip,
                    heart_rate_monitor_on: self.heart_rate_monitor_on,
                    unity_messages: self.unity_messages.clone(),
                    daily: self.daily.clone(),
                    pending_interactions: self.pending_interactions.clone(),
                },
            },
        })
        .unwrap_or_else(|_| "{}".to_string())
    }

    pub fn load_json(&mut self, save_json: &str) -> String {
        let envelope: EngineSaveEnvelope = match serde_json::from_str(save_json) {
            Ok(state) => state,
            Err(error) => {
                return serialize_events(vec![EngineEvent::system(format!(
                    "Save parse failed: {error}"
                ))]);
            }
        };
        if envelope.schema != ENGINE_SAVE_SCHEMA || envelope.version != ENGINE_SAVE_VERSION {
            return serialize_events(vec![EngineEvent::system(format!(
                "Unsupported save schema/version: {} v{}",
                envelope.schema, envelope.version
            ))]);
        }
        let snapshot = envelope.snapshot;
        self.current_flowchart = snapshot.navigation.flowchart;
        self.current_block = snapshot.navigation.block;
        self.current_index = snapshot.navigation.index;
        self.pending_choices = snapshot.pending.choices;
        self.pending_default_block = snapshot.pending.default_block;
        self.pending_default_seconds = snapshot.pending.default_seconds;
        self.pending_default_preserves_choices = snapshot.pending.default_preserves_choices;
        self.waiting = snapshot.pending.waiting;
        self.pending_invisible_choices = snapshot.pending.invisible_choices;
        self.pending_input = snapshot.pending.input;
        self.public_variables = snapshot.variables.public;
        self.private_variables = snapshot.variables.private;
        self.resources = snapshot.resources;
        self.audio = snapshot.audio;
        self.interactions = snapshot.interactions;
        self.achievements = snapshot.achievements.into_iter().collect();
        self.o2_run_out_flowchart = snapshot.systems.o2_run_out_flowchart;
        self.o2_hazard_enabled = snapshot.systems.o2_hazard_enabled;
        self.highlighted_button = snapshot.systems.highlighted_button;
        self.warning_animation = snapshot.systems.warning_animation;
        self.player_can_skip = snapshot.systems.player_can_skip;
        self.heart_rate_monitor_on = snapshot.systems.heart_rate_monitor_on;
        self.unity_messages = snapshot.systems.unity_messages;
        self.daily = snapshot.systems.daily;
        self.pending_interactions = snapshot.systems.pending_interactions;

        let mut events = vec![
            resources_event(self.resources.clone()),
            audio_state_event(self.audio.clone()),
            interactions_event(self.interactions.clone()),
        ];
        if !self.pending_choices.is_empty() {
            events.push(EngineEvent {
                event_type: "choices".to_string(),
                source: None,
                text: None,
                string_id: None,
                text_index: None,
                image_id: None,
                choices: Some(
                    self.pending_choices
                        .iter()
                        .map(|pending| pending.choice.clone())
                        .collect(),
                ),
                seconds: self.pending_default_seconds,
                audio_id: None,
                audio: None,
                resources: None,
                interactions: None,
            });
        } else if self.waiting {
            if let Some(seconds) = self
                .pending_default_seconds
                .filter(|seconds| *seconds > 0.0)
            {
                events.push(wait_event(seconds));
            }
        }
        serialize_events(events)
    }

    pub fn advance_time(&mut self, seconds: f64) -> String {
        let mut remaining = seconds.max(0.0);
        let mut events = Vec::new();
        let mut guard = 0usize;

        while remaining > 0.0 && guard < 16 {
            guard += 1;
            let wait_left = self.pending_default_seconds.unwrap_or(0.0);
            if self.waiting && wait_left > 0.0 {
                let elapsed = remaining.min(wait_left);
                self.advance_clock(elapsed);
                self.update_resources(elapsed);
                if self.resources.game_has_over {
                    events.push(resources_event(self.resources.clone()));
                    if self.o2_hazard_enabled {
                        events.extend(self.run_collect());
                    }
                    break;
                }
                if self.try_trigger_daily_insert(&mut events) {
                    remaining = 0.0;
                    continue;
                }
                if remaining < wait_left {
                    self.pending_default_seconds = Some(wait_left - elapsed);
                    remaining = 0.0;
                } else {
                    remaining -= wait_left;
                    self.waiting = false;
                    self.daily.waiting = false;
                    self.pending_default_seconds = None;
                    if !self.pending_default_preserves_choices {
                        self.pending_choices.clear();
                    }
                    self.pending_default_preserves_choices = false;
                    self.pending_invisible_choices.clear();
                    self.pending_input = None;
                    if let Some(target_block) = self.pending_default_block.take() {
                        self.current_block = target_block;
                        self.current_index = 0;
                    }
                    events.extend(self.run_collect());
                }
            } else {
                self.advance_clock(remaining);
                self.update_resources(remaining);
                if self.resources.game_has_over {
                    events.push(resources_event(self.resources.clone()));
                    if self.o2_hazard_enabled {
                        events.extend(self.run_collect());
                    }
                }
                remaining = 0.0;
            }
        }

        events.insert(0, resources_event(self.resources.clone()));
        if self.waiting {
            if let Some(seconds) = self
                .pending_default_seconds
                .filter(|seconds| *seconds > 0.0)
            {
                if self.pending_choices.is_empty() {
                    events.push(wait_event(seconds));
                } else {
                    events.push(choices_event(
                        self.pending_choices
                            .iter()
                            .map(|pending| pending.choice.clone())
                            .collect(),
                        Some(seconds),
                    ));
                }
            }
        }
        if guard >= 16 {
            events.push(EngineEvent::system(
                "Offline advance stopped after many chained waits.",
            ));
        }
        serialize_events(events)
    }

    pub fn set_clock_override_ms(&mut self, millis: f64) {
        self.clock_override_ms = Some(millis);
    }

    pub fn clear_clock_override(&mut self) {
        self.clock_override_ms = None;
    }
}

impl AliyaEngine {
    fn reset_runtime_state(&mut self) {
        self.pending_choices.clear();
        self.pending_default_block = None;
        self.pending_default_seconds = None;
        self.pending_default_preserves_choices = false;
        self.waiting = false;
        self.pending_invisible_choices.clear();
        self.pending_input = None;
        self.interactions = default_interactions();
        self.achievements.clear();
        self.o2_run_out_flowchart = "O2RunOut".to_string();
        self.o2_hazard_enabled = true;
        self.highlighted_button = None;
        self.warning_animation = false;
        self.player_can_skip = true;
        self.unity_messages.clear();
        self.daily = default_daily_state();
        self.pending_interactions.clear();
        let (public_variables, private_variables, default_variables) =
            initial_variables(&self.flowcharts);
        self.public_variables = public_variables;
        self.private_variables = private_variables;
        self.default_variables = default_variables;
        self.resources = ResourceState {
            o2_percent: 0.3,
            h2o_percent: 0.1,
            eng_percent: 0.4,
            heart_rate: 60,
            o2_consume_factor: 1.0,
            eog_is_on: false,
            game_has_over: false,
        };
        self.heart_rate_monitor_on = false;
        self.audio = default_audio_state();
        self.apply_debug_interaction_seeds();
        self.apply_debug_variable_seeds();
    }

    fn apply_debug_interaction_seeds(&mut self) {
        for (control, seed) in self.debug_interaction_seeds.clone() {
            self.apply_debug_interaction_seed(control, seed);
        }
    }

    fn apply_debug_interaction_seed(
        &mut self,
        control: InteractionControl,
        seed: InteractionSeedState,
    ) {
        match control {
            InteractionControl::Eog => {
                if let Some(can_interact) = seed.can_interact {
                    self.interactions.eog_can_interact = can_interact;
                }
                self.interactions.eog_is_on = seed.is_open;
                self.resources.eog_is_on = seed.is_open;
            }
            InteractionControl::Eh => {
                if let Some(can_interact) = seed.can_interact {
                    self.interactions.eh_can_interact = can_interact;
                }
                self.interactions.eh_is_open = seed.is_open;
            }
            InteractionControl::Radio => {
                if let Some(can_interact) = seed.can_interact {
                    self.interactions.radio_can_interact = can_interact;
                }
                self.interactions.radio_is_open = seed.is_open;
                self.update_radio_panel_audio_mix();
            }
        }
    }

    fn apply_debug_variable_seeds(&mut self) {
        for (key, value) in self.debug_variable_seeds.clone() {
            if key == "HRM_IS_ON" {
                self.heart_rate_monitor_on = value.as_bool().unwrap_or(false);
            } else if key == "RADIO_IS_ON" {
                self.interactions.radio_is_open = value.as_bool().unwrap_or(false);
                self.update_radio_panel_audio_mix();
            }
            self.public_variables.insert(key, value);
        }
    }

    fn run_until_halt(&mut self) -> String {
        serialize_events(self.run_collect())
    }

    fn run_collect(&mut self) -> Vec<EngineEvent> {
        let mut events = Vec::new();
        let mut guard = 0usize;

        while guard < 512 {
            guard += 1;
            let Some(command) = self.current_command().cloned() else {
                break;
            };
            self.current_index += 1;

            match command.command_type.as_str() {
                "AliyaMessage" => {
                    events.extend(self.aliya_message_events(&command));
                }
                "PlayerChoice" => {
                    self.pending_choices
                        .push(self.choice_from_command(&command));
                    self.collect_following_choices();
                    if !self.pending_choices.is_empty() {
                        events.push(EngineEvent {
                            event_type: "choices".to_string(),
                            source: None,
                            text: None,
                            string_id: None,
                            text_index: None,
                            image_id: None,
                            choices: Some(
                                self.pending_choices
                                    .iter()
                                    .map(|pending| pending.choice.clone())
                                    .collect(),
                            ),
                            seconds: self.pending_default_seconds,
                            audio_id: None,
                            audio: None,
                            resources: None,
                            interactions: None,
                        });
                    }
                    break;
                }
                "DefaultChoice" => {
                    let wait_seconds = read_wait_seconds(&command.fields);
                    self.pending_default_block = read_string(&command.fields, "targetBlock");
                    self.pending_default_seconds = Some(wait_seconds);
                    self.pending_default_preserves_choices = false;
                    self.waiting = wait_seconds > 0.0;
                    self.daily.waiting = false;
                    if wait_seconds > 0.0 {
                        events.push(wait_event(wait_seconds));
                    }
                    break;
                }
                "WaitTime" | "WaitPreciseTime" => {
                    let wait_seconds = if command.command_type == "WaitPreciseTime" {
                        self.read_precise_wait_seconds(&command)
                    } else {
                        read_wait_seconds(&command.fields)
                    };
                    self.pending_default_block = None;
                    self.pending_default_seconds = Some(wait_seconds);
                    self.pending_default_preserves_choices = false;
                    if wait_seconds > 0.0 {
                        self.waiting = true;
                        self.daily.waiting =
                            self.daily.undergoing && command.command_type == "WaitPreciseTime";
                        events.push(wait_event(wait_seconds));
                        break;
                    }
                    self.waiting = false;
                    self.daily.waiting = false;
                    self.pending_default_seconds = None;
                    self.pending_default_preserves_choices = false;
                }
                "If" => {
                    if !self.evaluate_if(&command) {
                        self.current_index = self.next_else_or_end_if_index(
                            self.current_index - 1,
                            command.indent_level,
                        );
                    }
                }
                "Else" => {
                    self.current_index =
                        self.next_end_if_index(self.current_index - 1, command.indent_level);
                }
                "EndIf" => {}
                "SetVariable" => {
                    self.set_variable_from_command(&command);
                }
                "PlayerInput" => {
                    if let Some(variable) = command.fields.get("stringVariable") {
                        if let Some(key) = read_string(variable, "key") {
                            self.pending_input = Some(InputRequestState {
                                variable_key: key,
                                send_message: read_bool(&command.fields, "sendMessage")
                                    .unwrap_or(true),
                            });
                            events.push(EngineEvent::system("需要输入一段文本。"));
                        }
                    }
                    break;
                }
                "InvisibleChoice" => {
                    if let Some(target_block) = read_string(&command.fields, "targetBlock") {
                        let rule = read_i32(&command.fields, "rule").unwrap_or(0);
                        self.pending_invisible_choices
                            .push(InvisibleChoiceState { rule, target_block });
                    }
                }
                "CallBlock" => {
                    if let Some(target) = read_string(&command.fields, "targetBlock") {
                        self.current_block = target;
                        self.current_index = 0;
                    }
                }
                "CallDailyPart" => {
                    self.daily.undergoing = true;
                    self.daily.waiting = false;
                    self.daily.in_insert = false;
                    self.daily.saved_position = None;
                    self.resources.game_has_over = false;
                    self.o2_hazard_enabled = false;
                    self.warning_animation = false;
                    self.current_flowchart = "Daily_1-1".to_string();
                    self.current_block = "Daily_1-1".to_string();
                    self.current_index = 0;
                }
                "CallFlowchart" => {
                    if let Some(target) = read_string(&command.fields, "flowchartName") {
                        self.current_flowchart = target.clone();
                        self.current_block =
                            read_string(&command.fields, "blockName").unwrap_or(target);
                        self.current_index = 0;
                    }
                }
                "SetO2ConsumeFactor" => {
                    let value = read_number(&command.fields, "targetValue").unwrap_or(1.0);
                    self.resources.o2_consume_factor = value.max(0.0);
                    events.push(resources_event(self.resources.clone()));
                }
                "ClampO2Res" => {
                    let min_value = read_number(&command.fields, "minValue").unwrap_or(0.0);
                    let max_value =
                        read_number(&command.fields, "maxValue").unwrap_or(O2_MAX_VALUE);
                    let o2_value =
                        (self.resources.o2_percent * O2_MAX_VALUE).clamp(min_value, max_value);
                    self.resources.o2_percent = (o2_value / O2_MAX_VALUE).clamp(0.0, 1.0);
                    events.push(resources_event(self.resources.clone()));
                }
                "ClampWaterRes" => {
                    let min_value = read_number(&command.fields, "minValue").unwrap_or(0.0);
                    let max_value =
                        read_number(&command.fields, "maxValue").unwrap_or(H2O_MAX_VALUE);
                    let h2o_value =
                        (self.resources.h2o_percent * H2O_MAX_VALUE).clamp(min_value, max_value);
                    self.resources.h2o_percent = (h2o_value / H2O_MAX_VALUE).clamp(0.0, 1.0);
                    events.push(resources_event(self.resources.clone()));
                }
                "SetENGRes" => {
                    let minus_value = read_number(&command.fields, "minusValue").unwrap_or(0.0);
                    let delta = (minus_value / ENG_MAX_VALUE).clamp(0.0, 0.4);
                    self.resources.eng_percent =
                        (self.resources.eng_percent - delta).clamp(0.0, 1.0);
                    events.push(resources_event(self.resources.clone()));
                }
                "SetHeartRate" => {
                    if let Some(level) = read_i32(&command.fields, "targetLevel") {
                        self.resources.heart_rate = heart_rate_for_level(level);
                        self.heart_rate_monitor_on = true;
                        events.push(resources_event(self.resources.clone()));
                    }
                }
                "ChangeBGMusic" => {
                    if let Some(music_id) = read_string(&command.fields, "musicId") {
                        self.audio.bgm_id = music_id;
                        events.push(audio_state_event(self.audio.clone()));
                    }
                }
                "ChangeRadioMusic" => {
                    if let Some(music_id) = read_string(&command.fields, "musicId") {
                        self.audio.radio_music_id = Some(music_id);
                        events.push(audio_state_event(self.audio.clone()));
                    }
                }
                "EnableRadioMusic" => {
                    if let Some(music_id) = read_string(&command.fields, "musicId") {
                        let init_quality =
                            read_number(&command.fields, "initQuality").unwrap_or(0.5);
                        let final_offset =
                            read_number(&command.fields, "finalPosPercentOffset").unwrap_or(0.25);
                        self.enable_radio_music(music_id, init_quality, final_offset);
                        events.push(audio_state_event(self.audio.clone()));
                    }
                }
                "DisableRadioMusic" => {
                    self.disable_radio_music();
                    events.push(audio_state_event(self.audio.clone()));
                }
                "ActivateEOG" => {
                    self.interactions.eog_can_interact = true;
                    events.push(interactions_event(self.interactions.clone()));
                }
                "BanEOGControl" => {
                    self.interactions.eog_can_interact = false;
                    events.push(interactions_event(self.interactions.clone()));
                }
                "ActivateEH" => {
                    self.interactions.eh_can_interact = true;
                    events.push(interactions_event(self.interactions.clone()));
                }
                "BanEHControl" => {
                    self.interactions.eh_can_interact = false;
                    events.push(interactions_event(self.interactions.clone()));
                }
                "ActivateRadio" => {
                    self.interactions.radio_can_interact = true;
                    events.push(interactions_event(self.interactions.clone()));
                }
                "BanRadioControl" => {
                    self.interactions.radio_can_interact = false;
                    events.push(interactions_event(self.interactions.clone()));
                }
                "SetEHValue" => {
                    self.interactions.eh_is_open =
                        read_bool(&command.fields, "setValue").unwrap_or(false);
                    events.push(interactions_event(self.interactions.clone()));
                }
                "SetRadioValue" => {
                    let target = read_bool(&command.fields, "setValue").unwrap_or(false);
                    if self.interactions.radio_is_open != target
                        && self.interactions.radio_can_interact
                    {
                        self.interactions.radio_is_open = target;
                        self.update_radio_panel_audio_mix();
                    }
                    events.push(interactions_event(self.interactions.clone()));
                    events.push(audio_state_event(self.audio.clone()));
                }
                "ConfigSpecialEnd" => {
                    self.o2_run_out_flowchart =
                        read_string(&command.fields, "o2RunOutFlowchartName")
                            .unwrap_or_else(|| "O2RunOut".to_string());
                    self.o2_hazard_enabled =
                        read_bool(&command.fields, "setCanTrigger").unwrap_or(false);
                    self.resources.game_has_over = false;
                }
                "GetAchievement" => {
                    if let Some(achievement_id) = read_string(&command.fields, "achievementId") {
                        self.achievements.insert(achievement_id.clone());
                        events.push(EngineEvent::system(format!("获得成就：{achievement_id}")));
                    }
                }
                "HighlightButton" => {
                    self.highlighted_button = read_i32(&command.fields, "buttonType");
                }
                "ToggleWarningAni" => {
                    self.warning_animation =
                        read_bool(&command.fields, "targetValue").unwrap_or(false);
                }
                "ConfigPlayerSkip" => {
                    self.player_can_skip = read_bool(&command.fields, "setValue").unwrap_or(true);
                }
                "SendMessage" => {
                    if let Some(message) = self.unity_message_text(&command) {
                        self.unity_messages.push(UnityMessageState {
                            flowchart: self.current_flowchart.clone(),
                            block: self.current_block.clone(),
                            item_id: command.item_id,
                            message_target: read_i32(&command.fields, "messageTarget").unwrap_or(0),
                            message,
                        });
                    }
                }
                "RestartGame" => {
                    self.restart_state();
                    events.push(EngineEvent::system("游戏已重启。"));
                    events.push(interactions_event(self.interactions.clone()));
                    events.push(audio_state_event(self.audio.clone()));
                    events.extend(self.run_collect());
                    break;
                }
                "ExitDailyInsert" => {
                    if let Some(position) = self.daily.saved_position.clone() {
                        self.daily.in_insert = false;
                        self.current_flowchart = position.flowchart;
                        self.current_block = position.block;
                        self.current_index = position.index;
                    } else {
                        events.push(EngineEvent::system(
                            "ExitDailyInsert called without a saved daily position.",
                        ));
                    }
                }
                "EndMark" => {
                    self.resources.game_has_over = true;
                    events.push(resources_event(self.resources.clone()));
                    break;
                }
                _ => {}
            }
        }

        if guard >= 512 {
            events.push(EngineEvent::system(
                "Execution guard stopped a long command chain.",
            ));
        }

        events
    }

    fn current_command(&self) -> Option<&Command> {
        self.flowcharts
            .flowcharts
            .get(&self.current_flowchart)?
            .blocks
            .get(&self.current_block)?
            .commands
            .get(self.current_index)
    }

    fn current_commands(&self) -> Option<&Vec<Command>> {
        self.flowcharts
            .flowcharts
            .get(&self.current_flowchart)?
            .blocks
            .get(&self.current_block)
            .map(|block| &block.commands)
    }

    fn next_else_or_end_if_index(&self, from_index: usize, indent_level: i32) -> usize {
        let Some(commands) = self.current_commands() else {
            return from_index + 1;
        };
        self.next_else_or_end_if_index_for(commands, from_index, indent_level)
    }

    fn next_end_if_index(&self, from_index: usize, indent_level: i32) -> usize {
        let Some(commands) = self.current_commands() else {
            return from_index + 1;
        };
        self.next_end_if_index_for(commands, from_index, indent_level)
    }

    fn next_else_or_end_if_index_for(
        &self,
        commands: &[Command],
        from_index: usize,
        indent_level: i32,
    ) -> usize {
        commands
            .iter()
            .enumerate()
            .skip(from_index + 1)
            .find(|(_, command)| {
                command.indent_level == indent_level
                    && matches!(command.command_type.as_str(), "Else" | "EndIf")
            })
            .map(|(index, _)| index + 1)
            .unwrap_or(commands.len())
    }

    fn next_end_if_index_for(
        &self,
        commands: &[Command],
        from_index: usize,
        indent_level: i32,
    ) -> usize {
        commands
            .iter()
            .enumerate()
            .skip(from_index + 1)
            .find(|(_, command)| {
                command.indent_level == indent_level && command.command_type == "EndIf"
            })
            .map(|(index, _)| index + 1)
            .unwrap_or(commands.len())
    }

    fn evaluate_if(&self, command: &Command) -> bool {
        let Some(conditions) = command.fields.get("conditions").and_then(Value::as_array) else {
            return false;
        };
        if conditions.is_empty() {
            return false;
        }
        let any_or_all = read_i32(&command.fields, "anyOrAllConditions").unwrap_or(0);
        if any_or_all == 0 {
            conditions
                .iter()
                .any(|condition| self.evaluate_condition(condition))
        } else {
            conditions
                .iter()
                .all(|condition| self.evaluate_condition(condition))
        }
    }

    fn evaluate_condition(&self, condition: &Value) -> bool {
        let Some(variable) = condition.get("variable") else {
            return false;
        };
        let Some(key) = read_string(variable, "key") else {
            return false;
        };
        let variable_type = read_string(variable, "type").unwrap_or_else(|| "string".to_string());
        let Some(left) = self.variable_value(&key) else {
            return false;
        };
        let right = self.resolve_command_value(condition, &variable_type);
        let compare_operator = read_i32(condition, "compareOperator").unwrap_or(0);
        compare_values(&left, &right, &variable_type, compare_operator)
    }

    fn set_variable_from_command(&mut self, command: &Command) {
        let Some(variable) = command.fields.get("variable") else {
            return;
        };
        let Some(key) = read_string(variable, "key") else {
            return;
        };
        let variable_type = read_string(variable, "type").unwrap_or_else(|| "string".to_string());
        let current_value = self
            .variable_value(&key)
            .unwrap_or_else(|| default_value_for_type(&variable_type));
        let set_value = self.resolve_command_value(&command.fields, &variable_type);
        let set_operator = read_i32(&command.fields, "setOperator").unwrap_or(0);
        let next_value =
            apply_set_operator(&current_value, &set_value, &variable_type, set_operator);
        let scope_name = read_string(variable, "scopeName").unwrap_or_else(|| "Public".to_string());
        self.set_variable_value(&key, next_value, &scope_name);
    }

    fn resolve_command_value(&self, fields: &Value, variable_type: &str) -> Value {
        if let Some(value_ref) = fields.get("valueRef") {
            if let Some(key) = read_string(value_ref, "key") {
                if let Some(value) = self.variable_value(&key) {
                    return value;
                }
            }
        }
        coerce_value(
            fields.get("value").cloned().unwrap_or(Value::Null),
            variable_type,
        )
    }

    fn variable_value(&self, key: &str) -> Option<Value> {
        if key == "NOW_O2_VALUE" {
            return Some(json!(self.resources.o2_percent * O2_MAX_VALUE));
        }
        if key == "NOW_H2O_VALUE" {
            return Some(json!(self.resources.h2o_percent * H2O_MAX_VALUE));
        }
        if key == "IS_MOBILE_ADAPT" {
            return self
                .debug_variable_seeds
                .get(key)
                .cloned()
                .or_else(|| self.public_variables.get(key).cloned())
                .or_else(|| Some(json!(false)));
        }
        if key == "HRM_IS_ON" {
            return self
                .debug_variable_seeds
                .get(key)
                .cloned()
                .or_else(|| Some(json!(self.heart_rate_monitor_on)));
        }
        if key == "RADIO_IS_ON" {
            return self
                .debug_variable_seeds
                .get(key)
                .cloned()
                .or_else(|| Some(json!(self.interactions.radio_is_open)));
        }
        if let Some(end_id) = key
            .strip_prefix("END_")
            .and_then(|rest| rest.strip_suffix("_IS_GET"))
        {
            return self
                .debug_variable_seeds
                .get(key)
                .cloned()
                .or_else(|| Some(json!(self.achievements.contains(&format!("End_{end_id}")))));
        }
        self.private_variables
            .get(&self.current_flowchart)
            .and_then(|variables| variables.get(key))
            .cloned()
            .or_else(|| self.public_variables.get(key).cloned())
            .or_else(|| {
                self.default_variables
                    .get(&self.current_flowchart)
                    .and_then(|variables| variables.get(key))
                    .cloned()
            })
    }

    fn set_variable_value(&mut self, key: &str, value: Value, scope_name: &str) {
        if scope_name == "Private" {
            self.private_variables
                .entry(self.current_flowchart.clone())
                .or_default()
                .insert(key.to_string(), value);
        } else {
            self.public_variables.insert(key.to_string(), value);
        }
    }

    fn unity_message_text(&self, command: &Command) -> Option<String> {
        command
            .fields
            .get("_message")
            .and_then(|value| read_string(value, "stringVal"))
            .filter(|value| !value.is_empty())
            .or_else(|| read_string(&command.fields, "messageOLD"))
            .filter(|value| !value.is_empty())
    }

    fn now_ms(&self) -> f64 {
        self.clock_override_ms.unwrap_or_else(now_ms)
    }

    fn advance_clock(&mut self, seconds: f64) {
        if let Some(value) = self.clock_override_ms.as_mut() {
            *value += seconds.max(0.0) * 1000.0;
        }
    }

    fn read_precise_wait_seconds(&mut self, command: &Command) -> f64 {
        let hour = read_i32(&command.fields, "hourNum")
            .unwrap_or(0)
            .clamp(0, 23);
        let minute = read_i32(&command.fields, "minuteNum")
            .unwrap_or(0)
            .clamp(0, 59);
        let need_new_day = read_bool(&command.fields, "needNewDay").unwrap_or(false);
        let now = self.now_ms();
        let target_today = local_date_time_ms(now, hour, minute, 0);
        let command_key = command_identity(&self.current_flowchart, &self.current_block, command);
        let target = if need_new_day {
            if self.daily.need_new_day_mark_command.as_deref() != Some(command_key.as_str()) {
                let next_day = add_days_ms(target_today, 1.0);
                self.daily.need_new_day_mark_command = Some(command_key);
                self.daily.need_new_day_mark_time_ms = Some(next_day);
                next_day
            } else {
                self.daily
                    .need_new_day_mark_time_ms
                    .unwrap_or_else(|| add_days_ms(target_today, 1.0))
            }
        } else if target_today <= now {
            now
        } else {
            target_today
        };
        ((target - now) / 1000.0).max(0.0)
    }

    fn queue_interaction_completion(&mut self, control: InteractionControl) {
        if self
            .pending_interactions
            .iter()
            .any(|pending| pending.control == control)
        {
            return;
        }
        self.pending_interactions.push(PendingInteractionState {
            control,
            remaining_seconds: INTERACTION_TOGGLE_SECONDS,
        });
    }

    fn update_pending_interactions(&mut self, seconds: f64, events: &mut Vec<EngineEvent>) {
        if self.pending_interactions.is_empty() {
            return;
        }
        let elapsed = seconds.max(0.0);
        let mut completed = Vec::new();
        for pending in &mut self.pending_interactions {
            pending.remaining_seconds -= elapsed;
            if pending.remaining_seconds <= 0.0 {
                completed.push(pending.control.clone());
            }
        }
        self.pending_interactions
            .retain(|pending| pending.remaining_seconds > 0.0);
        for control in completed {
            self.complete_interaction(control, events);
        }
    }

    fn complete_interaction(&mut self, control: InteractionControl, events: &mut Vec<EngineEvent>) {
        match control {
            InteractionControl::Eog => {
                self.interactions.eog_is_on = !self.interactions.eog_is_on;
                self.resources.eog_is_on = self.interactions.eog_is_on;
                events.push(resources_event(self.resources.clone()));
                events.push(interactions_event(self.interactions.clone()));
            }
            InteractionControl::Eh => {
                self.interactions.eh_is_open = !self.interactions.eh_is_open;
                events.push(interactions_event(self.interactions.clone()));
            }
            InteractionControl::Radio => {
                self.interactions.radio_is_open = !self.interactions.radio_is_open;
                self.update_radio_panel_audio_mix();
                events.push(interactions_event(self.interactions.clone()));
                events.push(audio_state_event(self.audio.clone()));
            }
        }
    }

    fn try_trigger_daily_insert(&mut self, events: &mut Vec<EngineEvent>) -> bool {
        if !self.daily.undergoing || !self.daily.waiting || self.daily.in_insert {
            return false;
        }
        let now = self.now_ms();
        let Some(config) = self
            .flowcharts
            .daily_insert_configs
            .iter()
            .find(|config| self.daily_insert_matches(config, now))
            .cloned()
        else {
            return false;
        };
        if config.flowchart_name.is_empty()
            || self
                .daily
                .triggered_inserts
                .iter()
                .any(|name| name == &config.flowchart_name)
        {
            return false;
        }
        if !self
            .flowcharts
            .flowcharts
            .contains_key(&config.flowchart_name)
        {
            events.push(EngineEvent::system(format!(
                "Daily insert flowchart not found: {}",
                config.flowchart_name
            )));
            return false;
        }

        self.daily.saved_position = Some(FlowchartPosition {
            flowchart: self.current_flowchart.clone(),
            block: self.current_block.clone(),
            index: self.current_index.saturating_sub(1),
        });
        self.daily
            .triggered_inserts
            .push(config.flowchart_name.clone());
        self.daily.in_insert = true;
        self.daily.waiting = false;
        self.waiting = false;
        self.pending_choices.clear();
        self.pending_default_block = None;
        self.pending_default_seconds = None;
        self.pending_default_preserves_choices = false;
        self.pending_invisible_choices.clear();
        self.pending_input = None;
        self.current_flowchart = config.flowchart_name.clone();
        self.current_block = config.flowchart_name;
        self.current_index = 0;
        events.extend(self.run_collect());
        true
    }

    fn daily_insert_matches(&self, config: &DailyInsertConfig, now: f64) -> bool {
        let start_date = local_month_day_ms(now, config.min_month, config.min_day, false);
        let end_date = local_month_day_ms(now, config.max_month, config.max_day, true);
        let start_moment = local_date_time_ms(now, config.min_hour, config.min_minute, 0);
        let end_moment = local_date_time_ms(now, config.max_hour, config.max_minute, 0);
        now >= start_date && now <= end_date && now >= start_moment && now <= end_moment
    }

    fn collect_following_choices(&mut self) {
        let mut guard = 0usize;
        while guard < 128 {
            guard += 1;
            let Some(command) = self.current_command().cloned() else {
                break;
            };
            match command.command_type.as_str() {
                "PlayerChoice" => {
                    self.current_index += 1;
                    self.pending_choices
                        .push(self.choice_from_command(&command));
                }
                "If" => {
                    self.current_index += 1;
                    if !self.evaluate_if(&command) {
                        self.current_index = self.next_else_or_end_if_index(
                            self.current_index - 1,
                            command.indent_level,
                        );
                    }
                }
                "Else" => {
                    self.current_index += 1;
                    self.current_index =
                        self.next_end_if_index(self.current_index - 1, command.indent_level);
                }
                "EndIf" => {
                    self.current_index += 1;
                }
                "InvisibleChoice" => {
                    self.current_index += 1;
                    if let Some(target_block) = read_string(&command.fields, "targetBlock") {
                        let rule = read_i32(&command.fields, "rule").unwrap_or(0);
                        self.pending_invisible_choices
                            .push(InvisibleChoiceState { rule, target_block });
                    }
                }
                "DefaultChoice" => {
                    self.current_index += 1;
                    let wait_seconds = read_wait_seconds(&command.fields);
                    self.pending_default_block = read_string(&command.fields, "targetBlock");
                    self.pending_default_seconds = Some(wait_seconds);
                    self.pending_default_preserves_choices = self
                        .pending_default_block
                        .as_deref()
                        .is_some_and(|target_block| {
                            !self.pending_choices.is_empty()
                                && self.target_block_starts_with_player_choice(target_block)
                        });
                    self.waiting = wait_seconds > 0.0;
                }
                _ => break,
            }
        }
    }

    fn target_block_starts_with_player_choice(&self, target_block: &str) -> bool {
        let Some(commands) = self
            .flowcharts
            .flowcharts
            .get(&self.current_flowchart)
            .and_then(|flowchart| flowchart.blocks.get(target_block))
            .map(|block| &block.commands)
        else {
            return false;
        };
        let mut index = 0usize;
        let mut guard = 0usize;
        while index < commands.len() && guard < 128 {
            guard += 1;
            let command = &commands[index];
            match command.command_type.as_str() {
                "PlayerChoice" => return true,
                "If" => {
                    index += 1;
                    if !self.evaluate_if(command) {
                        index = self.next_else_or_end_if_index_for(commands, index - 1, command.indent_level);
                    }
                }
                "Else" => {
                    index = self.next_end_if_index_for(commands, index, command.indent_level);
                }
                "EndIf" => {
                    index += 1;
                }
                _ => return false,
            }
        }
        false
    }

    fn choice_from_command(&self, command: &Command) -> PendingChoiceState {
        let string_id = command.string_id.clone();
        let raw_text = self.substitute_variables(
            &string_id
                .as_ref()
                .and_then(|key| self.localization.get(key))
                .cloned()
                .unwrap_or_else(|| read_string(&command.fields, "text").unwrap_or_default()),
        );
        let (text, localized_reply) = split_standard_choice_text(&raw_text);
        let custom_msg = read_string(&command.fields, "customMsgText")
            .filter(|text| !text.is_empty())
            .map(|text| self.substitute_variables(&text))
            .or(localized_reply);
        let custom_image =
            read_string(&command.fields, "customImgMsg").filter(|image_id| !image_id.is_empty());
        let target = read_string(&command.fields, "targetBlock").unwrap_or_default();
        let id = command
            .string_id
            .clone()
            .unwrap_or_else(|| format!("choice-{}", self.pending_choices.len()));
        PendingChoiceState {
            choice: ChoiceEvent {
                id,
                reply_text: custom_msg,
                reply_image_id: custom_image,
                text,
                string_id,
            },
            target_block: target,
        }
    }

    fn aliya_message_events(&self, command: &Command) -> Vec<EngineEvent> {
        let string_id = command.string_id.clone();
        let image_id = read_string(&command.fields, "imageId").unwrap_or_default();
        if !image_id.is_empty() {
            return vec![EngineEvent {
                event_type: "image".to_string(),
                source: Some("aliya".to_string()),
                text: None,
                string_id,
                text_index: None,
                image_id: Some(image_id),
                choices: None,
                seconds: None,
                audio_id: None,
                audio: None,
                resources: None,
                interactions: None,
            }];
        }

        let text = string_id
            .as_ref()
            .and_then(|key| self.localization.get(key))
            .cloned()
            .unwrap_or_else(|| read_string(&command.fields, "messageText").unwrap_or_default());
        let text = self.substitute_variables(&text);

        text.split('\n')
            .enumerate()
            .map(|(index, line)| EngineEvent {
                event_type: "message".to_string(),
                source: Some("aliya".to_string()),
                text: Some(line.to_string()),
                string_id: string_id.clone(),
                text_index: Some(index),
                image_id: None,
                choices: None,
                seconds: Some(message_wait(line)),
                audio_id: None,
                audio: None,
                resources: None,
                interactions: None,
            })
            .collect()
    }

    fn substitute_variables(&self, input: &str) -> String {
        let mut output = input.to_string();
        let mut search_from = 0usize;
        while let Some(start_offset) = output[search_from..].find("{$") {
            let start = search_from + start_offset;
            let Some(end_offset) = output[start..].find('}') else {
                break;
            };
            let end = start + end_offset;
            let key = output[start + 2..end].to_string();
            if let Some(replacement) = self.unity_token_replacement(&key) {
                output.replace_range(start..=end, &replacement);
                search_from = start + replacement.len();
            } else {
                search_from = end + 1;
            }
        }

        let keys: Vec<String> = self
            .default_variables
            .get(&self.current_flowchart)
            .into_iter()
            .flat_map(|variables| variables.keys())
            .chain(self.public_variables.keys())
            .cloned()
            .collect();
        for key in keys {
            let token = format!("{{{key}}}");
            if output.contains(&token) {
                let replacement = self
                    .variable_value(&key)
                    .map(|value| string_value(&value))
                    .unwrap_or_default();
                output = output.replace(&token, &replacement);
            }
        }
        output
    }

    fn unity_token_replacement(&self, key: &str) -> Option<String> {
        if key == "year" {
            return Some(current_year(self.now_ms()).to_string());
        }
        if key == "aliyaYear" && self.current_flowchart == "4-4" {
            return Some("3026".to_string());
        }
        self.variable_value(key).map(|value| string_value(&value))
    }

    fn update_resources(&mut self, seconds: f64) {
        if !self.resources.game_has_over {
            let o2_value = self.resources.o2_percent * O2_MAX_VALUE
                - self.resources.o2_consume_factor * seconds;
            self.resources.o2_percent = (o2_value / O2_MAX_VALUE).clamp(0.0, 1.0);
        }
        if self.resources.eog_is_on {
            let mut h2o_value = self.resources.h2o_percent * H2O_MAX_VALUE;
            let mut o2_value = self.resources.o2_percent * O2_MAX_VALUE;
            if h2o_value > 0.0 && o2_value < O2_MAX_VALUE {
                h2o_value -= 0.2 * seconds;
                o2_value += 700.0 * seconds;
            }
            self.resources.h2o_percent = (h2o_value / H2O_MAX_VALUE).clamp(0.0, 1.0);
            self.resources.o2_percent = (o2_value / O2_MAX_VALUE).clamp(0.0, 1.0);
        }
        if self.resources.o2_percent < 0.005 {
            self.resources.game_has_over = true;
            if self.o2_hazard_enabled {
                self.current_flowchart = self.o2_run_out_flowchart.clone();
                self.current_block = self.o2_run_out_flowchart.clone();
                self.current_index = 0;
                self.pending_choices.clear();
                self.pending_default_block = None;
                self.pending_default_seconds = None;
                self.pending_default_preserves_choices = false;
                self.pending_invisible_choices.clear();
                self.pending_input = None;
            }
        }
    }

    fn restart_state(&mut self) {
        let achievements = self.achievements.clone();
        self.current_flowchart = "1-1".to_string();
        self.current_block = "1-1".to_string();
        self.current_index = 0;
        self.reset_runtime_state();
        self.achievements = achievements;
    }

    fn update_radio_panel_audio_mix(&mut self) {
        if self.interactions.radio_is_open {
            self.audio.all_radio_audio_volume_percent = 1.0;
            self.audio.bgm_audio_volume_percent = 0.0;
        } else {
            self.audio.all_radio_audio_volume_percent = 0.0;
            self.audio.bgm_audio_volume_percent = 1.0;
        }
    }

    fn enable_radio_music(&mut self, music_id: String, init_quality: f64, final_offset: f64) {
        let quality = init_quality.clamp(0.0, 1.0);
        let offset = final_offset.clamp(0.0, 0.5);
        self.audio.radio_music_id = Some(music_id);
        self.audio.radio_music_enabled = true;
        self.audio.radio_pin_final_pos = Some(if self.audio.radio_pin_pos <= 0.5 {
            self.audio.radio_pin_pos + offset * (1.0 - quality)
        } else {
            self.audio.radio_pin_pos - offset * (1.0 - quality)
        });
        self.audio.radio_quality_per_pos_percent = offset;
        self.audio.radio_music_volume_percent = quality;
        self.audio.radio_noise_volume_percent = 1.0 - quality;
    }

    fn disable_radio_music(&mut self) {
        self.audio.radio_pin_final_pos = None;
        self.audio.radio_quality_per_pos_percent = 0.0;
        self.audio.radio_music_id = None;
        self.audio.radio_music_enabled = false;
        self.audio.radio_music_volume_percent = 0.0;
        self.audio.radio_noise_volume_percent = 1.0;
    }

    fn update_radio_tuning(&mut self) {
        let Some(final_pos) = self.audio.radio_pin_final_pos else {
            return;
        };
        if self.audio.radio_quality_per_pos_percent <= 0.0 {
            return;
        }
        let distance = (self.audio.radio_pin_pos - final_pos).abs();
        let quality = 1.0 - distance / self.audio.radio_quality_per_pos_percent;
        self.audio.radio_music_volume_percent = quality.clamp(0.0, 1.0);
        self.audio.radio_noise_volume_percent = (1.0 - quality).clamp(0.0, 1.0);
    }
}

impl EngineEvent {
    fn system<T: Into<String>>(text: T) -> EngineEvent {
        EngineEvent {
            event_type: "system".to_string(),
            source: Some("system".to_string()),
            text: Some(text.into()),
            string_id: None,
            text_index: None,
            image_id: None,
            choices: None,
            seconds: None,
            audio_id: None,
            audio: None,
            resources: None,
            interactions: None,
        }
    }
}

fn read_string(value: &Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(str::to_string)
}

fn read_number(value: &Value, key: &str) -> Option<f64> {
    value.get(key)?.as_f64()
}

fn read_i32(value: &Value, key: &str) -> Option<i32> {
    value
        .get(key)?
        .as_i64()
        .and_then(|value| i32::try_from(value).ok())
}

fn read_bool(value: &Value, key: &str) -> Option<bool> {
    let value = value.get(key)?;
    value
        .as_bool()
        .or_else(|| value.as_i64().map(|value| value != 0))
}

fn parse_interaction_control(control: &str) -> Option<InteractionControl> {
    match control {
        "eog" | "EOG" => Some(InteractionControl::Eog),
        "eh" | "EH" => Some(InteractionControl::Eh),
        "radio" | "RAD" | "Radio" => Some(InteractionControl::Radio),
        _ => None,
    }
}

fn interaction_rule(control: &InteractionControl) -> i32 {
    match control {
        InteractionControl::Eog => 1,
        InteractionControl::Eh => 2,
        InteractionControl::Radio => 3,
    }
}

fn default_interactions() -> InteractionState {
    InteractionState {
        eog_can_interact: false,
        eh_can_interact: false,
        radio_can_interact: false,
        eog_is_on: false,
        eh_is_open: false,
        radio_is_open: false,
    }
}

fn default_audio_state() -> AudioState {
    AudioState {
        bgm_id: "背景".to_string(),
        radio_music_id: None,
        radio_music_enabled: false,
        bgm_volume: 0.5,
        radio_volume: 0.5,
        sound_volume: 0.5,
        radio_pin_pos: 0.33,
        radio_pin_final_pos: None,
        radio_quality_per_pos_percent: 0.0,
        radio_music_volume_percent: 0.0,
        radio_noise_volume_percent: 1.0,
        all_radio_audio_volume_percent: 0.0,
        bgm_audio_volume_percent: 1.0,
        bgm_fade_seconds: 1.0,
    }
}

fn default_daily_state() -> DailyState {
    DailyState {
        undergoing: false,
        waiting: false,
        in_insert: false,
        saved_position: None,
        triggered_inserts: Vec::new(),
        need_new_day_mark_command: None,
        need_new_day_mark_time_ms: None,
        insert_check_accumulator: 0.0,
    }
}

fn initial_variables(
    flowcharts: &FlowchartsDocument,
) -> (
    HashMap<String, Value>,
    HashMap<String, HashMap<String, Value>>,
    HashMap<String, HashMap<String, Value>>,
) {
    let public_variables = HashMap::new();
    let mut private_variables = HashMap::new();
    let mut default_variables = HashMap::new();
    for (flowchart_name, flowchart) in &flowcharts.flowcharts {
        for variable in &flowchart.variables {
            let value = coerce_value(variable.default_value.clone(), &variable.variable_type);
            default_variables
                .entry(flowchart_name.clone())
                .or_insert_with(HashMap::new)
                .insert(variable.key.clone(), value.clone());
            if variable.scope_name == "Private" {
                private_variables
                    .entry(flowchart_name.clone())
                    .or_insert_with(HashMap::new)
                    .insert(variable.key.clone(), value);
            }
        }
    }
    (public_variables, private_variables, default_variables)
}

fn default_value_for_type(variable_type: &str) -> Value {
    match variable_type {
        "bool" => json!(false),
        "int" => json!(0),
        "float" => json!(0.0),
        "string" => json!(""),
        _ => Value::Null,
    }
}

fn coerce_value(value: Value, variable_type: &str) -> Value {
    match variable_type {
        "bool" => json!(value
            .as_bool()
            .unwrap_or_else(|| numeric_value(&value) != 0.0)),
        "int" => json!(int_value(&value)),
        "float" => json!(numeric_value(&value)),
        "string" => json!(string_value(&value)),
        _ => value,
    }
}

fn compare_values(left: &Value, right: &Value, variable_type: &str, compare_operator: i32) -> bool {
    match variable_type {
        "bool" => {
            let left = bool_value(left);
            let right = bool_value(right);
            match compare_operator {
                0 => left == right,
                1 => left != right,
                _ => false,
            }
        }
        "int" | "float" => {
            let left = numeric_value(left);
            let right = numeric_value(right);
            match compare_operator {
                0 => (left - right).abs() < f64::EPSILON,
                1 => (left - right).abs() >= f64::EPSILON,
                2 => left < right,
                3 => left > right,
                4 => left <= right,
                5 => left >= right,
                _ => false,
            }
        }
        "string" => {
            let left = string_value(left);
            let right = string_value(right);
            match compare_operator {
                0 => left == right,
                1 => left != right,
                _ => false,
            }
        }
        _ => false,
    }
}

fn apply_set_operator(
    current_value: &Value,
    set_value: &Value,
    variable_type: &str,
    set_operator: i32,
) -> Value {
    match variable_type {
        "bool" => {
            let value = bool_value(set_value);
            match set_operator {
                1 => json!(!value),
                _ => json!(value),
            }
        }
        "int" => {
            let current = int_value(current_value);
            let value = int_value(set_value);
            match set_operator {
                1 => json!(-current),
                2 => json!(current + value),
                3 => json!(current - value),
                4 => json!(current * value),
                5 => json!(if value == 0 { current } else { current / value }),
                _ => json!(value),
            }
        }
        "float" => {
            let current = numeric_value(current_value);
            let value = numeric_value(set_value);
            match set_operator {
                1 => json!(-current),
                2 => json!(current + value),
                3 => json!(current - value),
                4 => json!(current * value),
                5 => json!(if value.abs() < f64::EPSILON {
                    current
                } else {
                    current / value
                }),
                _ => json!(value),
            }
        }
        "string" => json!(string_value(set_value)),
        _ => set_value.clone(),
    }
}

fn bool_value(value: &Value) -> bool {
    value
        .as_bool()
        .unwrap_or_else(|| numeric_value(value) != 0.0)
}

fn int_value(value: &Value) -> i64 {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
        .unwrap_or_else(|| numeric_value(value) as i64)
}

fn numeric_value(value: &Value) -> f64 {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|value| value.parse::<f64>().ok()))
        .unwrap_or(0.0)
}

fn string_value(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| match value {
            Value::Bool(value) => value.to_string(),
            Value::Number(value) => value.to_string(),
            Value::Null => String::new(),
            _ => value.to_string(),
        })
}

fn read_wait_seconds(fields: &Value) -> f64 {
    let hours = read_number(fields, "waitHours").unwrap_or(0.0);
    let minutes = read_number(fields, "waitMinutes").unwrap_or(0.0);
    let seconds = read_number(fields, "waitSeconds").unwrap_or(0.0);
    hours * 3600.0 + minutes * 60.0 + seconds
}

fn current_year(reference_ms: f64) -> i32 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::new(&JsValue::from_f64(reference_ms)).get_full_year() as i32
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let days = (reference_ms / 86_400_000.0).floor() as i64;
        civil_year_from_days(days)
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn civil_year_from_days(days_since_unix_epoch: i64) -> i32 {
    let z = days_since_unix_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let month = mp + if mp < 10 { 3 } else { -9 };
    (y + if month <= 2 { 1 } else { 0 }) as i32
}

fn now_ms() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as f64)
            .unwrap_or(0.0)
    }
}

fn command_identity(flowchart: &str, block: &str, command: &Command) -> String {
    format!(
        "{}:{}:{}:{}",
        flowchart,
        block,
        command.command_type,
        command.item_id_string()
    )
}

impl Command {
    fn item_id_string(&self) -> String {
        self.item_id
            .map(|value| value.to_string())
            .unwrap_or_else(|| self.string_id.clone().unwrap_or_default())
    }
}

fn add_days_ms(time_ms: f64, days: f64) -> f64 {
    time_ms + days * 86_400_000.0
}

fn local_date_time_ms(reference_ms: f64, hour: i32, minute: i32, second: i32) -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        let reference = js_sys::Date::new(&JsValue::from_f64(reference_ms));
        let target = js_sys::Date::new_0();
        target.set_full_year(reference.get_full_year());
        target.set_month(reference.get_month());
        target.set_date(reference.get_date());
        target.set_hours(hour.clamp(0, 23) as u32);
        target.set_minutes(minute.clamp(0, 59) as u32);
        target.set_seconds(second.clamp(0, 59) as u32);
        target.set_milliseconds(0);
        target.get_time()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let day_start = (reference_ms / 86_400_000.0).floor() * 86_400_000.0;
        day_start
            + hour.clamp(0, 23) as f64 * 3_600_000.0
            + minute.clamp(0, 59) as f64 * 60_000.0
            + second.clamp(0, 59) as f64 * 1000.0
    }
}

fn local_month_day_ms(reference_ms: f64, month: i32, day: i32, end_of_day: bool) -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        let reference = js_sys::Date::new(&JsValue::from_f64(reference_ms));
        let target = js_sys::Date::new_0();
        target.set_full_year(reference.get_full_year());
        target.set_month((month.clamp(1, 12) - 1) as u32);
        target.set_date(day.clamp(1, 31) as u32);
        if end_of_day {
            target.set_hours(23);
            target.set_minutes(59);
            target.set_seconds(59);
            target.set_milliseconds(999);
        } else {
            target.set_hours(0);
            target.set_minutes(0);
            target.set_seconds(0);
            target.set_milliseconds(0);
        }
        target.get_time()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let day_start = (reference_ms / 86_400_000.0).floor() * 86_400_000.0;
        let month_offset = (month.clamp(1, 12) - 1) as f64 * 31.0;
        let day_offset = (day.clamp(1, 31) - 1) as f64;
        let value = day_start + (month_offset + day_offset) * 86_400_000.0;
        if end_of_day {
            value + 86_399_999.0
        } else {
            value
        }
    }
}

fn split_standard_choice_text(text: &str) -> (String, Option<String>) {
    if let Some((choice_text, reply_text)) = text.split_once(" |###| ") {
        return (choice_text.to_string(), Some(reply_text.to_string()));
    }
    if let Some((choice_text, reply_text)) = text.split_once("|###|") {
        return (
            choice_text.trim().to_string(),
            Some(reply_text.trim().to_string()),
        );
    }
    (text.to_string(), None)
}

fn message_wait(text: &str) -> f64 {
    0.6 + text.chars().count() as f64 * 0.2
}

fn wait_event(seconds: f64) -> EngineEvent {
    EngineEvent {
        event_type: "wait".to_string(),
        source: None,
        text: None,
        string_id: None,
        text_index: None,
        image_id: None,
        choices: None,
        seconds: Some(seconds),
        audio_id: None,
        audio: None,
        resources: None,
        interactions: None,
    }
}

fn choices_event(choices: Vec<ChoiceEvent>, seconds: Option<f64>) -> EngineEvent {
    EngineEvent {
        event_type: "choices".to_string(),
        source: None,
        text: None,
        string_id: None,
        text_index: None,
        image_id: None,
        choices: Some(choices),
        seconds,
        audio_id: None,
        audio: None,
        resources: None,
        interactions: None,
    }
}

fn player_reply_event(choice: ChoiceEvent) -> EngineEvent {
    if let Some(image_id) = choice.reply_image_id {
        return EngineEvent {
            event_type: "image".to_string(),
            source: Some("player".to_string()),
            text: None,
            string_id: None,
            text_index: None,
            image_id: Some(image_id),
            choices: None,
            seconds: None,
            audio_id: None,
            audio: None,
            resources: None,
            interactions: None,
        };
    }
    EngineEvent {
        event_type: "message".to_string(),
        source: Some("player".to_string()),
        text: Some(choice.reply_text.unwrap_or(choice.text)),
        string_id: choice.string_id,
        text_index: None,
        image_id: None,
        choices: None,
        seconds: None,
        audio_id: None,
        audio: None,
        resources: None,
        interactions: None,
    }
}

fn audio_state_event(audio: AudioState) -> EngineEvent {
    EngineEvent {
        event_type: "audio".to_string(),
        source: None,
        text: None,
        string_id: None,
        text_index: None,
        image_id: None,
        choices: None,
        seconds: None,
        audio_id: Some(audio.bgm_id.clone()),
        audio: Some(audio),
        resources: None,
        interactions: None,
    }
}

fn resources_event(resources: ResourceState) -> EngineEvent {
    EngineEvent {
        event_type: "resources".to_string(),
        source: None,
        text: None,
        string_id: None,
        text_index: None,
        image_id: None,
        choices: None,
        seconds: None,
        audio_id: None,
        audio: None,
        resources: Some(resources),
        interactions: None,
    }
}

fn interactions_event(interactions: InteractionState) -> EngineEvent {
    EngineEvent {
        event_type: "interactions".to_string(),
        source: None,
        text: None,
        string_id: None,
        text_index: None,
        image_id: None,
        choices: None,
        seconds: None,
        audio_id: None,
        audio: None,
        resources: None,
        interactions: Some(interactions),
    }
}

fn heart_rate_for_level(level: i32) -> i32 {
    match level {
        0 => 0,
        1 => 60,
        2 => 72,
        3 => 85,
        4 => 91,
        5 => 98,
        6 => 107,
        7 => 115,
        8 => 126,
        _ => 60,
    }
}

fn serialize_events(events: Vec<EngineEvent>) -> String {
    serde_json::to_string(&events).unwrap_or_else(|_| "[]".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine(flowcharts: Value) -> AliyaEngine {
        AliyaEngine::new(&flowcharts.to_string(), "{}").expect("engine should parse")
    }

    fn events(raw: String) -> Vec<Value> {
        serde_json::from_str(&raw).expect("events should parse")
    }

    fn text_events(raw: String) -> Vec<String> {
        events(raw)
            .into_iter()
            .filter_map(|event| {
                event
                    .get("text")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .collect()
    }

    #[test]
    fn save_json_uses_versioned_snapshot_envelope() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [],
                    "blocks": {
                        "1-1": {
                            "commands": [
                                {"type": "AliyaMessage", "stringId": null, "fields": {"messageText": "hi", "imageId": ""}}
                            ]
                        }
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);
        engine.start();

        let save: Value = serde_json::from_str(&engine.save_json()).unwrap();
        assert_eq!(save["schema"], ENGINE_SAVE_SCHEMA);
        assert_eq!(save["version"], ENGINE_SAVE_VERSION);
        assert_eq!(save["snapshot"]["navigation"]["flowchart"], "1-1");
        assert!(save["snapshot"]["variables"]["public"].is_object());
        assert!(save["snapshot"]["systems"]["daily"].is_object());
    }

    #[test]
    fn old_unversioned_save_is_rejected() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {"variables": [], "blocks": {"1-1": {"commands": []}}}
            }
        });
        let mut engine = engine(flowcharts);
        let messages = text_events(engine.load_json(r#"{"currentFlowchart":"1-1"}"#));
        assert!(messages
            .iter()
            .any(|message| message.contains("Save parse failed")));
    }

    #[test]
    fn send_message_records_unity_signal_without_chat_noise() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [],
                    "blocks": {
                        "1-1": {
                            "commands": [
                                {
                                    "type": "SendMessage",
                                    "itemId": 1,
                                    "fields": {
                                        "messageTarget": 1,
                                        "_message": {"stringVal": "isDoorOpen"},
                                        "messageOLD": ""
                                    }
                                }
                            ]
                        }
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);
        let events = events(engine.start());
        assert!(events.is_empty());

        let state: Value = serde_json::from_str(&engine.state_json()).unwrap();
        assert_eq!(state["unityMessages"][0]["message"], "isDoorOpen");
        assert_eq!(state["unityMessages"][0]["messageTarget"], 1);

        let save: Value = serde_json::from_str(&engine.save_json()).unwrap();
        assert_eq!(
            save["snapshot"]["systems"]["unityMessages"][0]["message"],
            "isDoorOpen"
        );
    }

    #[test]
    fn audio_commands_track_unity_audio_state() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [],
                    "blocks": {
                        "1-1": {
                            "commands": [
                                {"type": "ChangeBGMusic", "fields": {"musicId": "追逐"}},
                                {
                                    "type": "EnableRadioMusic",
                                    "fields": {
                                        "musicId": "NASA",
                                        "initQuality": 0.4,
                                        "finalPosPercentOffset": 0.2
                                    }
                                },
                                {"type": "ActivateRadio", "fields": {}},
                                {"type": "SetRadioValue", "fields": {"setValue": true}},
                                {"type": "DisableRadioMusic", "fields": {}}
                            ]
                        }
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);
        let events = events(engine.start());
        let audio_events: Vec<&Value> = events
            .iter()
            .filter(|event| event["eventType"] == "audio")
            .collect();
        assert_eq!(audio_events.len(), 4);

        let state: Value = serde_json::from_str(&engine.state_json()).unwrap();
        assert_eq!(state["audio"]["bgmId"], "追逐");
        assert_eq!(state["audio"]["radioMusicId"], Value::Null);
        assert_eq!(state["audio"]["radioMusicEnabled"], false);
        assert_eq!(state["audio"]["radioPinPos"], 0.33);
        assert_eq!(state["audio"]["radioNoiseVolumePercent"], 1.0);
        assert_eq!(state["audio"]["allRadioAudioVolumePercent"], 1.0);
        assert_eq!(state["audio"]["bgmAudioVolumePercent"], 0.0);
        assert_eq!(state["interactions"]["radioIsOpen"], true);
    }

    #[test]
    fn set_radio_value_respects_unity_interaction_gate() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [],
                    "blocks": {
                        "1-1": {
                            "commands": [
                                {"type": "SetRadioValue", "fields": {"setValue": true}},
                                {
                                    "type": "EnableRadioMusic",
                                    "fields": {
                                        "musicId": "八音盒",
                                        "initQuality": 1.0,
                                        "finalPosPercentOffset": 0.15
                                    }
                                }
                            ]
                        }
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);
        let _ = engine.start();

        let state: Value = serde_json::from_str(&engine.state_json()).unwrap();
        assert_eq!(state["interactions"]["radioCanInteract"], false);
        assert_eq!(state["interactions"]["radioIsOpen"], false);
        assert_eq!(state["audio"]["radioMusicId"], "八音盒");
        assert_eq!(state["audio"]["radioMusicVolumePercent"], 1.0);
        assert_eq!(state["audio"]["radioNoiseVolumePercent"], 0.0);
        assert_eq!(state["audio"]["allRadioAudioVolumePercent"], 0.0);
        assert_eq!(state["audio"]["bgmAudioVolumePercent"], 1.0);
    }

    #[test]
    fn player_interact_respects_unity_interaction_gates() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [],
                    "blocks": {
                        "1-1": {
                            "commands": [
                                {"type": "AliyaMessage", "fields": {"messageText": "ready", "imageId": ""}}
                            ]
                        }
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);
        let _ = engine.start();

        let events = events(engine.interact("radio"));
        assert_eq!(events.len(), 2);
        let state: Value = serde_json::from_str(&engine.state_json()).unwrap();
        assert_eq!(state["interactions"]["radioCanInteract"], false);
        assert_eq!(state["interactions"]["radioIsOpen"], false);
        assert_eq!(state["audio"]["allRadioAudioVolumePercent"], 0.0);
        assert_eq!(state["audio"]["bgmAudioVolumePercent"], 1.0);
    }

    #[test]
    fn radio_is_on_dynamic_variable_tracks_radio_interaction() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [
                        {"key": "RADIO_IS_ON", "type": "bool", "scopeName": "Public", "defaultValue": false}
                    ],
                    "blocks": {
                        "1-1": {
                            "commands": [
                                {"type": "ActivateRadio", "fields": {}},
                                {"type": "WaitTime", "fields": {"waitHours": 0, "waitMinutes": 0, "waitSeconds": 1}},
                                {
                                    "type": "If",
                                    "indentLevel": 0,
                                    "fields": {
                                        "anyOrAllConditions": 0,
                                        "conditions": [
                                            {
                                                "compareOperator": 0,
                                                "variable": {"key": "RADIO_IS_ON", "type": "bool", "scopeName": "Public"},
                                                "value": true,
                                                "valueType": "bool",
                                                "valueRef": null
                                            }
                                        ]
                                    }
                                },
                                {"type": "PlayerChoice", "indentLevel": 1, "stringId": "on", "fields": {"text": "radio on", "targetBlock": "done"}},
                                {"type": "Else", "indentLevel": 0, "fields": {}},
                                {"type": "PlayerChoice", "indentLevel": 1, "stringId": "off", "fields": {"text": "radio off", "targetBlock": "done"}},
                                {"type": "EndIf", "indentLevel": 0, "fields": {}}
                            ]
                        },
                        "done": {"commands": []}
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);
        let start_events = events(engine.start());
        assert!(start_events
            .iter()
            .any(|event| event["eventType"] == "wait"));

        let _ = engine.interact("radio");
        let immediate_events = events(engine.continue_after_wait());
        assert!(immediate_events.iter().any(|event| {
            event["eventType"] == "choices" && event["choices"][0]["text"] == "radio off"
        }));

        let _ = engine.debug_jump_to("1-1", "1-1");
        let _ = engine.interact("radio");
        let _ = engine.tick(INTERACTION_TOGGLE_SECONDS);
        let events = events(engine.continue_after_wait());
        assert!(events.iter().any(|event| {
            event["eventType"] == "choices" && event["choices"][0]["text"] == "radio on"
        }));
    }

    #[test]
    fn heart_rate_monitor_dynamic_variable_turns_on_after_set_heart_rate() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [],
                    "blocks": {
                        "1-1": {
                            "commands": [
                                {"type": "SetHeartRate", "fields": {"targetLevel": 3}},
                                {"type": "CallFlowchart", "fields": {"flowchartName": "3-1"}}
                            ]
                        }
                    }
                },
                "3-1": {
                    "variables": [
                        {"key": "HRM_IS_ON", "type": "bool", "scopeName": "Public", "defaultValue": false}
                    ],
                    "blocks": {
                        "3-1": {
                            "commands": [
                                {
                                    "type": "If",
                                    "indentLevel": 0,
                                    "fields": {
                                        "anyOrAllConditions": 0,
                                        "conditions": [
                                            {
                                                "compareOperator": 0,
                                                "variable": {"key": "HRM_IS_ON", "type": "bool", "scopeName": "Public"},
                                                "value": true,
                                                "valueType": "bool",
                                                "valueRef": null
                                            }
                                        ]
                                    }
                                },
                                {"type": "PlayerChoice", "indentLevel": 1, "stringId": "hrm.on", "fields": {"text": "hrm on", "targetBlock": "done"}},
                                {"type": "Else", "indentLevel": 0, "fields": {}},
                                {"type": "PlayerChoice", "indentLevel": 1, "stringId": "hrm.off", "fields": {"text": "hrm off", "targetBlock": "done"}},
                                {"type": "EndIf", "indentLevel": 0, "fields": {}}
                            ]
                        },
                        "done": {"commands": []}
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);
        let events = events(engine.start());
        assert!(events.iter().any(|event| {
            event["eventType"] == "choices" && event["choices"][0]["text"] == "hrm on"
        }));

        let state: Value = serde_json::from_str(&engine.state_json()).unwrap();
        assert_eq!(state["heartRateMonitorOn"], true);
    }

    #[test]
    fn restart_game_emits_reset_audio_state() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [],
                    "blocks": {
                        "1-1": {"commands": []},
                        "radio": {
                            "commands": [
                                {
                                    "type": "EnableRadioMusic",
                                    "fields": {
                                        "musicId": "八音盒",
                                        "initQuality": 1.0,
                                        "finalPosPercentOffset": 0.15
                                    }
                                },
                                {"type": "RestartGame", "fields": {}}
                            ]
                        }
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);
        let events = events(engine.debug_jump_to("1-1", "radio"));
        let audio_events: Vec<&Value> = events
            .iter()
            .filter(|event| event["eventType"] == "audio")
            .collect();
        let last_audio = audio_events
            .last()
            .expect("restart should emit audio reset");
        assert_eq!(last_audio["audio"]["radioMusicId"], Value::Null);
        assert_eq!(last_audio["audio"]["radioNoiseVolumePercent"], 1.0);
        assert_eq!(last_audio["audio"]["allRadioAudioVolumePercent"], 0.0);
        assert_eq!(last_audio["audio"]["bgmAudioVolumePercent"], 1.0);
    }

    #[test]
    fn player_custom_image_reply_omits_choice_string_id() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [],
                    "blocks": {
                        "start": {
                            "commands": [
                                {
                                    "type": "PlayerChoice",
                                    "stringId": "PlayerChoice.1-1.1.",
                                    "fields": {
                                        "text": "send image",
                                        "targetBlock": "done",
                                        "customImgMsg": "7"
                                    }
                                }
                            ]
                        },
                        "done": {"commands": []}
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);
        let _ = engine.debug_jump_to("1-1", "start");

        let events = events(engine.choose("PlayerChoice.1-1.1."));
        let image = events
            .iter()
            .find(|event| event["eventType"] == "image")
            .expect("custom image reply should emit a player image");
        assert_eq!(image["source"], "player");
        assert_eq!(image["imageId"], "7");
        assert_eq!(image["stringId"], Value::Null);
    }

    #[test]
    fn player_choice_group_keeps_choices_after_default_choice() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [],
                    "blocks": {
                        "1-1": {
                            "commands": [
                                {"type": "PlayerChoice", "stringId": "choice.a", "fields": {"text": "A", "targetBlock": "a"}},
                                {"type": "DefaultChoice", "fields": {"waitHours": 0, "waitMinutes": 0, "waitSeconds": 4, "targetBlock": "fallback"}},
                                {"type": "PlayerChoice", "stringId": "choice.b", "fields": {"text": "B", "targetBlock": "b"}},
                                {"type": "PlayerChoice", "stringId": "choice.c", "fields": {"text": "C", "targetBlock": "c"}}
                            ]
                        },
                        "a": {"commands": []},
                        "b": {"commands": []},
                        "c": {"commands": []},
                        "fallback": {"commands": []}
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);
        let events = events(engine.start());
        let choices = events
            .iter()
            .find(|event| event["eventType"] == "choices")
            .expect("choices event should exist");
        assert_eq!(choices["choices"].as_array().unwrap().len(), 3);
        assert_eq!(choices["seconds"], 4.0);
    }

    #[test]
    fn default_choice_trigger_preserves_visible_choices_and_appends_target_choices() {
        let flowcharts = json!({
            "flowcharts": {
                "RE": {
                    "variables": [],
                    "blocks": {
                        "结局": {
                            "commands": [
                                {"type": "PlayerChoice", "stringId": "PlayerChoice.RE.19.", "fields": {"text": "你是...", "targetBlock": "回应"}},
                                {"type": "DefaultChoice", "fields": {"waitHours": 0, "waitMinutes": 10, "waitSeconds": 0, "targetBlock": "玩家没有即时回答"}}
                            ]
                        },
                        "玩家没有即时回答": {
                            "commands": [
                                {"type": "PlayerChoice", "stringId": "PlayerChoice.RE.64.", "fields": {"text": "等等...发生什么了", "targetBlock": "回应"}}
                            ]
                        },
                        "回应": {"commands": []}
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);
        let first_events = events(engine.debug_jump_to("RE", "结局"));
        let first_choices = first_events
            .iter()
            .find(|event| event["eventType"] == "choices")
            .expect("initial choices event should exist");
        assert_eq!(first_choices["choices"].as_array().unwrap().len(), 1);

        let events = events(engine.continue_after_wait());
        let choices = events
            .iter()
            .find(|event| event["eventType"] == "choices")
            .expect("default target choices event should exist");
        let texts: Vec<&str> = choices["choices"]
            .as_array()
            .unwrap()
            .iter()
            .map(|choice| choice["text"].as_str().unwrap())
            .collect();
        assert_eq!(texts, vec!["你是...", "等等...发生什么了"]);
    }

    #[test]
    fn default_choice_target_message_clears_previous_visible_choices() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [],
                    "blocks": {
                        "start": {
                            "commands": [
                                {"type": "PlayerChoice", "stringId": "old.a", "fields": {"text": "old A", "targetBlock": "manual"}},
                                {"type": "PlayerChoice", "stringId": "old.b", "fields": {"text": "old B", "targetBlock": "manual"}},
                                {"type": "DefaultChoice", "fields": {"waitHours": 0, "waitMinutes": 0, "waitSeconds": 5, "targetBlock": "fallback"}}
                            ]
                        },
                        "fallback": {
                            "commands": [
                                {"type": "AliyaMessage", "stringId": "fallback.message", "fields": {"messageText": "timeout"}},
                                {"type": "PlayerChoice", "stringId": "new.a", "fields": {"text": "new A", "targetBlock": "manual"}}
                            ]
                        },
                        "manual": {"commands": []}
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);
        let _ = engine.debug_jump_to("1-1", "start");
        let events = events(engine.continue_after_wait());
        let choices = events
            .iter()
            .find(|event| event["eventType"] == "choices")
            .expect("default target choices event should exist");
        let texts: Vec<&str> = choices["choices"]
            .as_array()
            .unwrap()
            .iter()
            .map(|choice| choice["text"].as_str().unwrap())
            .collect();
        assert_eq!(texts, vec!["new A"]);
    }

    #[test]
    fn restart_game_preserves_unity_end_achievement_dynamic_variables() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [
                        {"key": "END_2_IS_GET", "type": "bool", "scopeName": "Public", "defaultValue": false}
                    ],
                    "blocks": {
                        "1-1": {
                            "commands": [
                                {
                                    "type": "If",
                                    "indentLevel": 0,
                                    "fields": {
                                        "anyOrAllConditions": 0,
                                        "conditions": [
                                            {
                                                "compareOperator": 0,
                                                "variable": {"key": "END_2_IS_GET", "type": "bool", "scopeName": "Public"},
                                                "value": false,
                                                "valueType": "bool",
                                                "valueRef": null
                                            }
                                        ]
                                    }
                                },
                                {"type": "PlayerChoice", "indentLevel": 1, "stringId": "wrong", "fields": {"text": "wrong", "targetBlock": "wrong"}},
                                {"type": "EndIf", "indentLevel": 0, "fields": {}},
                                {"type": "PlayerChoice", "stringId": "right", "fields": {"text": "right", "targetBlock": "right"}}
                            ]
                        },
                        "award": {
                            "commands": [
                                {"type": "GetAchievement", "fields": {"achievementId": "End_2"}},
                                {"type": "RestartGame", "fields": {}}
                            ]
                        },
                        "wrong": {"commands": []},
                        "right": {"commands": []}
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);
        let events = events(engine.debug_jump_to("1-1", "award"));
        let choices = events
            .iter()
            .find(|event| event["eventType"] == "choices")
            .expect("restart should reach initial choices");
        let texts: Vec<&str> = choices["choices"]
            .as_array()
            .unwrap()
            .iter()
            .map(|choice| choice["text"].as_str().unwrap())
            .collect();
        assert_eq!(texts, vec!["right"]);
    }

    #[test]
    fn matching_end_achievements_drive_unity_end_is_get_variables() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [
                        {"key": "END_2_IS_GET", "type": "bool", "scopeName": "Public", "defaultValue": false}
                    ],
                    "blocks": {
                        "1-1": {
                            "commands": [
                                {
                                    "type": "If",
                                    "indentLevel": 0,
                                    "fields": {
                                        "anyOrAllConditions": 0,
                                        "conditions": [
                                            {
                                                "compareOperator": 0,
                                                "variable": {"key": "END_2_IS_GET", "type": "bool", "scopeName": "Public"},
                                                "value": false,
                                                "valueType": "bool",
                                                "valueRef": null
                                            }
                                        ]
                                    }
                                },
                                {"type": "PlayerChoice", "indentLevel": 1, "stringId": "visible", "fields": {"text": "visible", "targetBlock": "visible"}},
                                {"type": "EndIf", "indentLevel": 0, "fields": {}}
                            ]
                        },
                        "award": {
                            "commands": [
                                {"type": "GetAchievement", "fields": {"achievementId": "End_2"}},
                                {"type": "RestartGame", "fields": {}}
                            ]
                        },
                        "visible": {"commands": []}
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);
        let events = events(engine.debug_jump_to("1-1", "award"));
        assert!(!events.iter().any(|event| event["eventType"] == "choices"));
    }

    #[test]
    fn debug_seeded_mobile_adapt_overrides_desktop_dynamic_default() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [
                        {"key": "IS_MOBILE_ADAPT", "type": "bool", "scopeName": "Public", "defaultValue": false}
                    ],
                    "blocks": {
                        "1-1": {
                            "commands": [
                                {
                                    "type": "If",
                                    "indentLevel": 0,
                                    "fields": {
                                        "anyOrAllConditions": 0,
                                        "conditions": [
                                            {
                                                "compareOperator": 0,
                                                "variable": {"key": "IS_MOBILE_ADAPT", "type": "bool", "scopeName": "Public"},
                                                "value": true,
                                                "valueType": "bool",
                                                "valueRef": null
                                            }
                                        ]
                                    }
                                },
                                {"type": "PlayerChoice", "indentLevel": 1, "stringId": "mobile", "fields": {"text": "mobile", "targetBlock": "mobile"}},
                                {"type": "Else", "indentLevel": 0, "fields": {}},
                                {"type": "PlayerChoice", "indentLevel": 1, "stringId": "desktop", "fields": {"text": "desktop", "targetBlock": "desktop"}},
                                {"type": "EndIf", "indentLevel": 0, "fields": {}}
                            ]
                        },
                        "mobile": {"commands": []},
                        "desktop": {"commands": []}
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);
        let desktop_events = events(engine.start());
        assert!(desktop_events.iter().any(|event| {
            event["eventType"] == "choices" && event["choices"][0]["text"] == "desktop"
        }));

        engine.debug_set_variable("IS_MOBILE_ADAPT", "bool", "true");
        let mobile_events = events(engine.debug_jump_to("1-1", "1-1"));
        assert!(mobile_events.iter().any(|event| {
            event["eventType"] == "choices" && event["choices"][0]["text"] == "mobile"
        }));
    }

    #[test]
    fn debug_seeded_achievements_survive_start_and_jump() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [
                        {"key": "END_1_IS_GET", "type": "bool", "scopeName": "Public", "defaultValue": false}
                    ],
                    "blocks": {
                        "1-1": {
                            "commands": [
                                {
                                    "type": "If",
                                    "indentLevel": 0,
                                    "fields": {
                                        "anyOrAllConditions": 0,
                                        "conditions": [
                                            {
                                                "compareOperator": 0,
                                                "variable": {"key": "END_1_IS_GET", "type": "bool", "scopeName": "Public"},
                                                "value": false,
                                                "valueType": "bool",
                                                "valueRef": null
                                            }
                                        ]
                                    }
                                },
                                {"type": "PlayerChoice", "indentLevel": 1, "stringId": "hidden", "fields": {"text": "hidden", "targetBlock": "hidden"}},
                                {"type": "EndIf", "indentLevel": 0, "fields": {}}
                            ]
                        },
                        "hidden": {"commands": []}
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);
        engine.debug_set_achievement("End_1", true);
        let events = events(engine.debug_jump_to("1-1", "1-1"));
        assert!(!events.iter().any(|event| event["eventType"] == "choices"));

        let state: Value = serde_json::from_str(&engine.state_json()).unwrap();
        assert!(state["achievements"]
            .as_array()
            .unwrap()
            .iter()
            .any(|achievement| achievement == "End_1"));
    }

    #[test]
    fn radio_tuning_uses_unity_pin_formula() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [],
                    "blocks": {
                        "1-1": {
                            "commands": [
                                {
                                    "type": "EnableRadioMusic",
                                    "fields": {
                                        "musicId": "NASA",
                                        "initQuality": 0.4,
                                        "finalPosPercentOffset": 0.2
                                    }
                                }
                            ]
                        }
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);
        let _ = engine.start();

        let state: Value = serde_json::from_str(&engine.state_json()).unwrap();
        assert_eq!(state["audio"]["radioPinPos"], 0.33);
        assert!((state["audio"]["radioPinFinalPos"].as_f64().unwrap() - 0.45).abs() < 0.0001);
        assert!((state["audio"]["radioMusicVolumePercent"].as_f64().unwrap() - 0.4).abs() < 0.0001);
        assert!((state["audio"]["radioNoiseVolumePercent"].as_f64().unwrap() - 0.6).abs() < 0.0001);

        let events = events(engine.tune_radio(0.45));
        assert_eq!(events[0]["eventType"], "audio");
        let state: Value = serde_json::from_str(&engine.state_json()).unwrap();
        assert!((state["audio"]["radioMusicVolumePercent"].as_f64().unwrap() - 1.0).abs() < 0.0001);
        assert!((state["audio"]["radioNoiseVolumePercent"].as_f64().unwrap() - 0.0).abs() < 0.0001);

        let _ = engine.tune_radio(0.0);
        let state: Value = serde_json::from_str(&engine.state_json()).unwrap();
        assert_eq!(state["audio"]["radioPinPos"], 0.0);
        assert_eq!(state["audio"]["radioMusicVolumePercent"], 0.0);
        assert_eq!(state["audio"]["radioNoiseVolumePercent"], 1.0);
    }

    #[test]
    fn debug_jump_to_runs_named_flowchart_block_for_audits() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [],
                    "blocks": {
                        "1-1": {"commands": []}
                    }
                },
                "2-1": {
                    "variables": [],
                    "blocks": {
                        "2-1": {
                            "commands": [
                                {"type": "AliyaMessage", "fields": {"messageText": "jumped", "imageId": ""}}
                            ]
                        }
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);
        let messages = text_events(engine.debug_jump_to("2-1", "2-1"));
        assert_eq!(messages, vec!["jumped".to_string()]);

        let state: Value = serde_json::from_str(&engine.state_json()).unwrap();
        assert_eq!(state["flowchart"], "2-1");
        assert_eq!(state["block"], "2-1");

        let messages = text_events(engine.debug_jump_to_index("2-1", "2-1", 1));
        assert!(messages.is_empty());
        let state: Value = serde_json::from_str(&engine.state_json()).unwrap();
        assert_eq!(state["index"], 1);

        let messages = text_events(engine.debug_jump_to("missing", "2-1"));
        assert!(messages
            .iter()
            .any(|message| message.contains("Debug jump flowchart not found")));
    }

    #[test]
    fn runtime_variable_substitution_matches_unity_token_rules() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [],
                    "blocks": {
                        "1-1": {
                            "commands": [
                                {
                                    "type": "PlayerInput",
                                    "fields": {
                                        "sendMessage": 0,
                                        "stringVariable": {
                                            "key": "name",
                                            "type": "string",
                                            "scopeName": "Public"
                                        }
                                    }
                                },
                                {
                                    "type": "AliyaMessage",
                                    "fields": {
                                        "messageText": "你好{$name}，今年是{$aliyaYear}年，不是{$year}年。",
                                        "imageId": ""
                                    }
                                },
                                {
                                    "type": "PlayerChoice",
                                    "stringId": "choice.date",
                                    "fields": {
                                        "text": "fallback",
                                        "targetBlock": "next",
                                        "customMsgText": "回声{$name}/{$fatherYear}"
                                    }
                                }
                            ]
                        },
                        "next": {"commands": []}
                    }
                },
                "4-4": {
                    "variables": [],
                    "blocks": {
                        "念信": {
                            "commands": [
                                {
                                    "type": "PlayerChoice",
                                    "stringId": "choice.aliya-year",
                                    "fields": {
                                        "text": "fallback",
                                        "targetBlock": "next"
                                    }
                                }
                            ]
                        },
                        "next": {"commands": []}
                    }
                }
            }
        });
        let localization = json!({
            "choice.date": "选项{$name}/{$year} |###| 回复{$name}/{$aliyaYear}",
            "choice.aliya-year": "现在你那边的时间是{$aliyaYear}年..."
        });
        let mut engine = AliyaEngine::new(&flowcharts.to_string(), &localization.to_string())
            .expect("engine should parse");
        engine.set_clock_override_ms(1_767_225_600_000.0);
        let messages = text_events(engine.start());
        assert_eq!(messages, vec!["需要输入一段文本。".to_string()]);

        let emitted_events = events(engine.submit_input("Mos"));
        let message_texts: Vec<String> = emitted_events
            .iter()
            .filter(|event| event["eventType"] == "message")
            .filter_map(|event| event["text"].as_str().map(str::to_string))
            .collect();
        assert_eq!(
            message_texts,
            vec!["你好Mos，今年是{$aliyaYear}年，不是2026年。".to_string()]
        );

        let choices = emitted_events
            .iter()
            .find(|event| event["eventType"] == "choices")
            .expect("choices event should exist");
        assert_eq!(choices["choices"][0]["text"], "选项Mos/2026");

        let choice_id = choices["choices"][0]["id"].as_str().unwrap().to_string();
        let reply_events = events(engine.choose(&choice_id));
        assert_eq!(reply_events[0]["text"], "回声Mos/{$fatherYear}");

        let jump_events = events(engine.debug_jump_to("4-4", "念信"));
        let choices = jump_events
            .iter()
            .find(|event| event["eventType"] == "choices")
            .expect("4-4 choices event should exist");
        assert_eq!(choices["choices"][0]["text"], "现在你那边的时间是3026年...");
    }

    #[test]
    fn daily_insert_triggers_and_exit_returns_to_saved_wait() {
        let flowcharts = json!({
            "dailyInsertConfigs": [
                {
                    "minMonth": 1,
                    "minDay": 1,
                    "maxMonth": 12,
                    "maxDay": 31,
                    "minHour": 0,
                    "minMinute": 0,
                    "maxHour": 23,
                    "maxMinute": 59,
                    "flowchartName": "Mid-Autumn_Festival"
                }
            ],
            "flowcharts": {
                "1-1": {
                    "variables": [],
                    "blocks": {
                        "1-1": {
                            "commands": [
                                {"type": "CallDailyPart", "fields": {}}
                            ]
                        }
                    }
                },
                "Daily_1-1": {
                    "variables": [],
                    "blocks": {
                        "Daily_1-1": {
                            "commands": [
                                {
                                    "type": "WaitPreciseTime",
                                    "itemId": 1,
                                    "fields": {"hourNum": 23, "minuteNum": 59, "needNewDay": 0}
                                },
                                {"type": "AliyaMessage", "fields": {"messageText": "daily back", "imageId": ""}}
                            ]
                        }
                    }
                },
                "Mid-Autumn_Festival": {
                    "variables": [],
                    "blocks": {
                        "Mid-Autumn_Festival": {
                            "commands": [
                                {"type": "AliyaMessage", "fields": {"messageText": "insert", "imageId": ""}},
                                {"type": "CallBlock", "fields": {"targetBlock": "NEXT"}}
                            ]
                        },
                        "NEXT": {
                            "commands": [
                                {"type": "ExitDailyInsert", "fields": {}}
                            ]
                        }
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);
        engine.set_clock_override_ms(12.0 * 3_600_000.0);

        let start_messages = text_events(engine.start());
        assert!(start_messages.is_empty());

        let state: Value = serde_json::from_str(&engine.state_json()).unwrap();
        assert_eq!(state["flowchart"], "Daily_1-1");
        assert_eq!(state["daily"]["undergoing"], true);
        assert_eq!(state["daily"]["waiting"], true);

        let tick_messages = text_events(engine.tick(5.0));
        assert_eq!(tick_messages, vec!["insert".to_string()]);

        let state: Value = serde_json::from_str(&engine.state_json()).unwrap();
        assert_eq!(state["flowchart"], "Daily_1-1");
        assert_eq!(state["block"], "Daily_1-1");
        assert_eq!(state["index"], 1);
        assert_eq!(state["daily"]["inInsert"], false);
        assert_eq!(state["daily"]["triggeredInserts"][0], "Mid-Autumn_Festival");
    }

    #[test]
    fn debug_daily_insert_jump_provides_exit_context_for_oracle_traces() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [],
                    "blocks": {
                        "1-1": {
                            "commands": []
                        }
                    }
                },
                "Mid-Autumn_Festival": {
                    "variables": [],
                    "blocks": {
                        "Mid-Autumn_Festival": {
                            "commands": [
                                {"type": "AliyaMessage", "fields": {"messageText": "insert", "imageId": ""}},
                                {"type": "CallBlock", "fields": {"targetBlock": "NEXT"}}
                            ]
                        },
                        "NEXT": {
                            "commands": [
                                {"type": "ExitDailyInsert", "fields": {}}
                            ]
                        }
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);

        let emitted = events(engine.debug_jump_daily_insert_to_index(
            "Mid-Autumn_Festival",
            "Mid-Autumn_Festival",
            0,
        ));
        let system_errors: Vec<String> = emitted
            .iter()
            .filter(|event| event["eventType"] == "system")
            .filter_map(|event| event["text"].as_str().map(str::to_string))
            .collect();
        assert!(!system_errors
            .iter()
            .any(|text| text.contains("ExitDailyInsert called without")));
        let messages: Vec<String> = emitted
            .iter()
            .filter(|event| event["eventType"] == "message")
            .filter_map(|event| event["text"].as_str().map(str::to_string))
            .collect();
        assert_eq!(messages, vec!["insert".to_string()]);

        let state: Value = serde_json::from_str(&engine.state_json()).unwrap();
        assert_eq!(state["flowchart"], "Mid-Autumn_Festival");
        assert_eq!(state["block"], "Mid-Autumn_Festival");
        assert_eq!(state["index"], 2);
        assert_eq!(state["daily"]["inInsert"], false);
        assert_eq!(state["daily"]["triggeredInserts"][0], "Mid-Autumn_Festival");
    }

    #[test]
    fn need_new_day_false_precise_wait_continues_if_time_already_passed() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [],
                    "blocks": {
                        "1-1": {
                            "commands": [
                                {
                                    "type": "WaitPreciseTime",
                                    "itemId": 1,
                                    "fields": {"hourNum": 1, "minuteNum": 0, "needNewDay": 0}
                                },
                                {"type": "AliyaMessage", "fields": {"messageText": "continued", "imageId": ""}}
                            ]
                        }
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);
        engine.set_clock_override_ms(12.0 * 3_600_000.0);
        let messages = text_events(engine.start());
        assert_eq!(messages, vec!["continued".to_string()]);
    }

    #[test]
    fn wait_time_advances_to_following_commands() {
        let flowcharts = json!({
            "flowcharts": {
                "1-1": {
                    "variables": [],
                    "blocks": {
                        "1-1": {
                            "commands": [
                                {"type": "AliyaMessage", "fields": {"messageText": "before", "imageId": ""}},
                                {"type": "WaitTime", "fields": {"waitHours": 0, "waitMinutes": 0, "waitSeconds": 2}},
                                {"type": "AliyaMessage", "fields": {"messageText": "after", "imageId": ""}}
                            ]
                        }
                    }
                }
            }
        });
        let mut engine = engine(flowcharts);

        let messages = text_events(engine.start());
        assert_eq!(messages, vec!["before".to_string()]);

        let state: Value = serde_json::from_str(&engine.state_json()).unwrap();
        assert_eq!(state["pending"]["waiting"], true);
        assert_eq!(state["pending"]["defaultSeconds"], 2.0);

        let messages = text_events(engine.advance_time(2.0));
        assert_eq!(messages, vec!["after".to_string()]);

        let state: Value = serde_json::from_str(&engine.state_json()).unwrap();
        assert_eq!(state["pending"]["waiting"], false);
        assert_eq!(state["pending"]["defaultSeconds"], Value::Null);
    }
}
