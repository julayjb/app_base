// =====================================================================
// mapping-new_v003.js — PontoBots
// Versão: 3.0.0 — 2026-05-19
// Base: mapping-new_v002.js
//
// MUDANÇAS v003:
// - FIX v004: DERIV_REDIRECT_URI → produção (app.pontobots.com)
// - FIX v004: isAuthValid() com verificação de expiração JWT
// - FIX v004: _needsLogin com verificação de expiração JWT
// - FIX v004: is_valid_to_sell com fallback robusto (master + slave)
// - FIX v004: vEval.send() com guard readyState no handler POC
// - FIX v004: btn_run verifica WS pronto antes de iniciar
// - FIX v004: btn_stop envia forget_all (proposal + poc)
// - FIX v004: closeResponseV catch com writeLog + notify após max tentativas
// - FIX v004: setupNewApiWebSockets slave obrigatório (try/catch separados)
// - FIX v004: mainLogic slaveAuthorized sem bypass isNewApiUser
// - FIX: isTokenExpired() para verificar expiração de token JWT
// - FIX: clearAuthState() para limpeza completa de autenticação
// - FIX: resetTradingState() para reset de estado de trading
// - FIX: closeResponse/closeResponseV com verificação de token expirado
// - FIX: Reconexão com backoff exponencial (max 5 tentativas)
// - FIX: parseFloat() em ask_price, payout, profit (podem ser string na nova API)
// - FIX: Fallback robusto para display_value (removido na nova API)
// - FIX: Guard clauses isNewApiUser em authorize handlers
// - FIX: mainLogic com verificação de WS readyState
// - FIX: mainPurchase com validação de WS antes de send
// - FIX: selectMasterAccount com resetTradingState e cancelamento de reconexão
// - FIX: conn_nya usado em vez de vEval/v direto nos proposal handlers
// - FIX: Type safety em updateResult/updateResultV
// - ADD: Variáveis de controle de reconexão (newApiReconnectAttempts, etc.)
// =====================================================================



// ===== NOVA API DERIV - CONSTANTES =====
const DERIV_CLIENT_ID = "32GpfVoE9TYu2037ADwey";
const DERIV_REDIRECT_URI = "https://app.pontobots.com"; // FIX v004: URL de produção
const DERIV_REST_BASE = "https://api.derivws.com";
// ===== HELPERS: acesso seguro aos tokens (DOM pode ser null) =====
const getMToken = () => { const el = document.getElementById('inpMToken'); return el ? el.value : (localStorage.getItem('inpMToken') || ''); };
const getSToken = () => { const el = document.getElementById('inpSToken'); return el ? el.value : (localStorage.getItem('inpSToken') || ''); };

// ===== FUNÇÕES UTILITÁRIAS (v003) =====
// Verifica se um token JWT está expirado
// Suporta JWT (3 partes) e tokens opacos (ex: ory_ac_...)
function isTokenExpired(token) {
    if (!token) return true;
    try {
        const parts = token.split('.');
        // JWT padrão: 3 partes (header.payload.signature)
        if (parts.length === 3) {
            const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const payload = JSON.parse(atob(base64));
            if (!payload.exp) return false;
            return (Date.now() / 1000) >= (payload.exp - 60); // margem de 60s
        }
        // Token opaco (ex: ory_at_...): verifica pelo timestamp salvo no login
        // FIX v004: usa deriv_token_expiry gravado no token exchange
        const stored = localStorage.getItem('deriv_token_expiry');
        if (stored) {
            return Date.now() >= (Number(stored) - 60000); // margem de 60s
        }
        return false; // sem timestamp → assume válido (Deriv rejeita server-side se expirado)
    } catch(e) {
        console.warn('[isTokenExpired] Erro ao decodificar token:', e);
        return true;
    }
}

// Limpa todo o estado de autenticação
function clearAuthState() {
    localStorage.removeItem('deriv_access_token');
    localStorage.removeItem('deriv_token_expiry'); // FIX v004 Bug B: limpa timestamp de expiração
    localStorage.removeItem('deriv_is_new_api');
    localStorage.removeItem('deriv_accounts_cache');
    localStorage.removeItem('inpMToken');
    localStorage.removeItem('inpSToken');
    localStorage.removeItem('currentMasterIndex');
    localStorage.removeItem('auth_invalid');
    localStorage.removeItem('pkce_code_verifier');
    localStorage.removeItem('oauth_state');
    localStorage.removeItem('new_login_pending');
    isNewApiUser = false;
    newApiAccessToken = null;
    masterAccounts = [];
    virtualAccount = null;
    if (newApiReconnectTimer) {
        clearTimeout(newApiReconnectTimer);
        newApiReconnectTimer = null;
    }
    console.log('[clearAuthState] Estado de autenticação limpo');
}

// Reseta o estado de trading (sem afetar autenticação)
function resetTradingState() {
    prContract.length = 0;
    winContract.length = 0;
    loseContract.length = 0;
    isContractValidToSell.length = 0;
    sellProfitLoss.length = 0;
    arrsellProfitLoss_multimarket.length = 0;
    arr_multimarketVendido.length = 0;
    lastTimeMasukPOC.length = 0;
    timerStartPLANB.forEach(t => clearTimeout(t));
    timerDoPLANB.forEach(t => clearTimeout(t));
    timerStartPLANB.length = 0;
    timerDoPLANB.length = 0;
    rowActive.length = 0;
    countVLose = 0;
    countVLoseIntermediarioVirtual = 0;
    countVLoseIntermediarioReal = 0;
    countVLoseWinVirtual = 0;
    countVLoseProgressivoVirtual = 0;
    countVLoseProgressivoRealWins = 0;
    padraoVLoseAtualIndex = 0;
    padraoVLoseSequencia.length = 0;
    emModoVirtual = true;
    totalProfit = 0;
    totalProfitMax = 0;
    stakeNow = 0;
    sedangPurchasing = false;
    sedangForgetAllTicks = false;
    sedangPantauContractPos = -1;
    tempWinInARow = 0;
    tempLossInARow = 0;
    // FIX v003c: NÃO resetar newApiReconnectAttempts aqui
    // Resetar o contador de reconexão aqui causava loop infinito:
    // toda troca de conta (selectMasterAccount) resetava o contador,
    // permitindo infinitas tentativas de reconexão em caso de falha
    console.log('[resetTradingState] Estado de trading resetado');
}
// =========================================

// rgbToHex: declarada no topo para evitar TDZ (temporal dead zone) em módulos ES6
// Chamada em showUpAllAboutTick (linha ~2433) antes da posição original (~7552)
const rgbToHex = aff => {
  if (aff.charAt(0) == "r") {
    aff = aff.replace("rgb(", "").replace(")", "").split(",");
    var afg = parseInt(aff[0], 10).toString(16);
    var afh = parseInt(aff[1], 10).toString(16);
    var afi = parseInt(aff[2], 10).toString(16);
    afg = afg.length == 1 ? "0" + afg : afg;
    afh = afh.length == 1 ? "0" + afh : afh;
    afi = afi.length == 1 ? "0" + afi : afi;
    return "#" + afg + afh + afi;
  }
};

let isNewApiUser = false;         // true para usuários com token ory_at_
let newApiAccessToken = null;     // access_token do novo OAuth
let vEval = null;                 // declarado como let para ser reatribuível
const timerStartPLANBOffset = 5;
const timerDoPLANBOffset = 5;
let timerStartPLANB = [];
let timerDoPLANB = [];
let tempDuration = 0;
let tempDurationUnit;
let tempDetikPengali;
let lastTimeGetTick = 0;
let lastTimeCheckIfReadyToMainLogic = 0;
let lastTimeCheckIfReadyToMainLogic_continuousindices = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
let i;
let k;

let masterAccounts = [];
let virtualAccount = null;
let currentMasterIndex = 0;

let tickArrayUtama = [];
let tickArrayUtamaText = [];
let digitArrayUtama = [];

let candleArrayUtama = [];
let openArrayUtama = [];
let highArrayUtama = [];
let lowArrayUtama = [];
let closeArrayUtama = [];
let granularityArray = [60, 120, 180, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 86400];
let granularityNamesArray = [["1 minuto", "60"], ["2 minutos", "120"], ["3 minutos", "180"], ["5 minutos", "300"], ["10 minutos", "600"], ["15 minutos", "900"], ["30 minutos", "1800"], ["1 hora", "3600"], ["2 horas", "7200"], ["4 horas", "14400"], ["8 horas", "28800"], ["24 horas", "86400"]];
let idSubCandlesHistory = "";
let mainChartCandles;
let candleData = {};

let idSubTicksHistory = "";
let idSubBalance = "";
let masterCurrency = "";
let slaveCurrency = "";
let wsMasterOpened = false;
let wsSlaveOpened = false;
let wsSlaveSudahFirstOpened = false;
let sedangAuthorize = false;
let sedangAuthorizeV = false;
let slaveAuthorized = false;
let countVLose = 0;

// ===== DATA WEBSOCKETS (NOVA API) =====
let vData1 = null;
let vData2 = null;
let wsData1Opened = false;
let wsData2Opened = false;
let pingInterval = null;
const PUBLIC_WS = "wss://api.derivws.com/trading/v1/options/ws/public";
// =======================================

// ===== CONTROLE DE RECONEXÃO (v003) =====
// FIX v003c: Timers e contadores SEPARADOS para master e slave
// Bug anterior: master e slave compartilhavam o mesmo timer/contador,
// causando cancelamento mútuo e loop infinito de reconexão
let newApiReconnectAttempts = 0;
let newApiReconnectAttemptsV = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let newApiReconnectTimer = null;
let newApiReconnectTimerV = null;
// ==========================================

// ===== VIRTUAL LOSS AVANÇADO - VARIÁVEIS =====
let countVLoseIntermediarioVirtual = 0;  // Contador de losses virtuais consecutivos (modo intermediário)
let countVLoseIntermediarioReal = 0;     // Contador de losses reais consecutivos (modo intermediário)
let countVLoseWinVirtual = 0;            // Contador de wins virtuais consecutivos (modo Virtual Win)
let padraoVLoseAtualIndex = 0;           // Índice atual na sequência do padrão VL/VW
let padraoVLoseSequencia = [];           // Array com a sequência parseada (ex: ["VL", "VL", "VW"])
let emModoVirtual = true;                // Controla se está em modo virtual ou real
// ===== MODO PROGRESSIVO - VARIÁVEIS =====
let countVLoseProgressivoVirtual = 0;     // Contador de losses virtuais
let countVLoseProgressivoRealWins = 0;    // Contador de wins consecutivos em real

let sedangPurchasing = false;
let sedangForgetAllTicks = false;
let prContract = [];
let winContract = [];
let loseContract = [];
let tempPrContractPos;
let lastContractIdV = 0;
let stakeNow = 0;
let totalProfit = 0;
let totalProfitMax = 0;
let conn_nya;
let maxColor = "rgb(127, 255, 212)";
let minColor = "rgb(255, 95, 31)";
let baseColor = "rgb(255, 255, 143)";
let colorRise = "#42a5f5";
let colorFall = "#f44336";
let colorNo = "#808080";
let colorWormNo = "#0f0";
let verdeEscuro = "#023d28";
let roxoEscuro = "#310357";
let colorpai = "#1f2129";
let colorkid = "#282b38";
let timeMayOP = 0;
let lastLDP = -1;
let tempCount = 0;
let tempLDP;
let lastColor = -1;
let arrMarket = [];
let arrMarketToSubMarket = [];
let arrSubMarketToSymbol = [];
let el;
let v;
let loginID;
let isVirtual;
let slaveLoginID;
let slaveIsVirtual;
let mainWorkspaceCode;
let mainChartLast10Dig_Digit;
let mainChartLast10Dig_Change;
let mainChart20Cater;
let mainChartLast10Tick_Tick;
let mainChartLast10Tick_Change;
let mainChart20TickWorm;
let mainChartTickTrisma;
let tempArray1;
let tempArray2;
let tempArray3;
let lastCont_askprice;
let lastCont_payout;
let lastCont_profit;
let lastCont_contracttype;
let lastCont_entrytime;
let lastCont_entryvalue;
let lastCont_entryvaluestring;
let lastCont_exittime;
let lastCont_exitvalue;
let lastCont_exitvaluestring;
let lastCont_barrier;
let lastCont_result;
let lastCont_market;
let izinRun2 = false;
let func$1$9$8$7$RunOnceAtStart = () => {
  izinRun2 = false;
};
let func$1$9$8$7$PurchaseConditions = () => {
  if (izinRun2) {
    izinRun2 = false;
  }
};
let func$1$9$8$7$SellConditions = () => {};
let func$1$9$8$7$RestartTradingConditions = () => {};
let func$1$9$8$7$PurchaseConditions_continuousindices = () => {};
let sudahRunOnceAtStart = false;
let mainSymbol = "";
let sedangPantauContractPos = -1;
let isContractValidToSell = [];
let sellProfitLoss = [];
let arrsellProfitLoss_multimarket = [];
let arr_multimarketVendido = [];
let market_symbol;
let cont_id;
let cont_type;
let cont_profit;
let initWorkspaceBlock = "{\"blocks\":{\"languageVersion\":0,\"blocks\":[{\"type\":\"runonceatstart\",\"id\":\"RLoGFD/l:WR[I^uo*+k3\",\"x\":10,\"y\":10,\"inputs\":{\"statement_runonceatstart\":{\"block\":{\"type\":\"readyfortrade\",\"id\":\"/S?3[Ux8c2wQ.UR3dBEo\"}}}},{\"type\":\"purchaseconditions\",\"id\":\"|!|d5xn:=b08sQWUU0Av\",\"x\":10,\"y\":107,\"inputs\":{\"statement_purchaseconditions\":{\"block\":{\"type\":\"controls_if\",\"id\":\"mApwxUtfhpdSi`3D8xoD\",\"extraState\":{\"hasElse\":true},\"inputs\":{\"ELSE\":{\"block\":{\"type\":\"checkagain\",\"id\":\"h:5~S!I;5F0a:qF-Ek(s\"}}}}}}},{\"type\":\"restarttradingconditions\",\"id\":\"A)}IH]$#NmR6#$VO9}l:\",\"x\":10,\"y\":279,\"inputs\":{\"statement_restarttradingconditions\":{\"block\":{\"type\":\"tradeagain\",\"id\":\"e!!Ha=/,E4OwxaR#GpVE\"}}}}]}}";
let lastTimeMasukPOC = [];
let tempWinInARow = 0;
let tempLossInARow = 0;
let idSubTicksHistory_continuous = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
let lastTimeGetTick_continuous = [];
let tickArrayUtama_continuous = [];
let tickArrayUtamaText_continuous = [];
let digitArrayUtama_continuous = [];
let arrMarket_Continuous = ["1HZ10V", "1HZ25V", "1HZ50V", "1HZ75V", "1HZ100V", "R_10", "R_25", "R_50", "R_75", "R_100"];
let mainTickArray_continuousindices = [];
let mainDigitArray_continuousindices = [];
let mainMarket_continuousindices;
let checkbox_check_market_nya = [];
//const g = String.fromCodePoint(51, 42) + String.fromCodePoint(55, 51) + "+" + String.fromCodePoint(52, 53, 49, 48, 57) + "+" + "60790" + String.fromCodePoint(41, 41);
//const g = String.fromCodePoint(51, 42) + String.fromCodePoint(55, 51) + "+" + String.fromCodePoint(52, 53, 49, 48, 57) + String.fromCodePoint(41, 41);
const g = String.fromCodePoint(51, 42) + String.fromCodePoint(55, 51) + "+" + String.fromCodePoint(49, 48, 53, 56, 57, 57) + String.fromCodePoint(41, 41);//Retorna "105899"

const urlParams = new URLSearchParams(window.location.search);
const selMarket = document.querySelector("#selMarket");
const selSubMarket = document.querySelector("#selSubMarket");
const selSymbol = document.querySelector("#selSymbol");
const selMoneyManagement = document.getElementById("selMoneyManagement");
const divInpInitStake = document.getElementById("divInpInitStake");
const lblInpInitStake = document.getElementById("lblInpInitStake");
const inpInitStake = document.querySelector("#inpInitStake");
const divInpMartiFactor = document.getElementById("divInpMartiFactor");
const inpMartiFactor = document.querySelector("#inpMartiFactor");
const divInpCycleStake = document.getElementById("divInpCycleStake");
const inpCycleStake = document.getElementById("inpCycleStake");
const divChkSmart = document.getElementById("divChkSmart");
const chkSmart = document.getElementById("chkSmart");
let posCycleStake = 0;
const chkTP = document.querySelector("#chkTP");
const inpTP = document.querySelector("#inpTP");
const chkSL = document.querySelector("#chkSL");
const inpSL = document.querySelector("#inpSL");
const chkNumOfWin = document.querySelector("#chkNumOfWin");
const inpNumOfWin = document.querySelector("#inpNumOfWin");
const chkNumOfLoss = document.querySelector("#chkNumOfLoss");
const inpNumOfLoss = document.querySelector("#inpNumOfLoss");
const chkNumOfRun = document.querySelector("#chkNumOfRun");
const inpNumOfRun = document.querySelector("#inpNumOfRun");
const chkNumOfWinInARow = document.querySelector("#chkNumOfWinInARow");
const inpNumOfWinInARow = document.querySelector("#inpNumOfWinInARow");
const chkNumOfLossInARow = document.querySelector("#chkNumOfLossInARow");
const inpNumOfLossInARow = document.querySelector("#inpNumOfLossInARow");
const chkVLose = document.querySelector("#chkVLose");
const inpVLose = document.querySelector("#inpVLose");

// ===== VIRTUAL LOSS AVANÇADO - SELETORES DOM =====
const selVLoseTipo = document.querySelector("#selVLoseTipo");                           // Dropdown: Simples/Avançado
const selVLoseSubmodo = document.querySelector("#selVLoseSubmodo");                     // Dropdown submodo avançado
const divVLoseSimples = document.querySelector("#divVLoseSimples");                     // Container modo simples
const divVLoseAvancado = document.querySelector("#divVLoseAvancado");                   // Container modo avançado
const divVLoseIntermediario = document.querySelector("#divVLoseIntermediario");         // Container intermediário
const divVLoseWin = document.querySelector("#divVLoseWin");                             // Container virtual win
const divVLosePadrao = document.querySelector("#divVLosePadrao");                       // Container padrão
const inpVLoseIntermediarioVirtual = document.querySelector("#inpVLoseIntermediarioVirtual"); // Qtde de loss virtual (intermediário)
const inpVLoseIntermediarioReal = document.querySelector("#inpVLoseIntermediarioReal");       // Qtde de loss real (intermediário)
const inpVLoseWinVirtual = document.querySelector("#inpVLoseWinVirtual");                     // Qtde de wins virtuais
const inpVLosePadrao = document.querySelector("#inpVLosePadrao");                            // Sequência customizada VL/VW
// ===== MODO PROGRESSIVO - SELETORES DOM =====
const divVLoseProgressivo = document.querySelector("#divVLoseProgressivo");
const inpVLoseProgressivoVirtual = document.querySelector("#inpVLoseProgressivoVirtual");
const inpVLoseProgressivoRealWins = document.querySelector("#inpVLoseProgressivoRealWins");



const chkDelayWin = document.querySelector("#chkDelayWin");
const inpDelayWin = document.querySelector("#inpDelayWin");
const chkDelayLose = document.querySelector("#chkDelayLose");
const inpDelayLose = document.querySelector("#inpDelayLose");
const selData = document.querySelector("#selData");
const digitstatistic_noofticks = [];

const subscribeAllCandles = () => {
  arrMarket_Continuous.forEach(symbol => {
    granularityArray.forEach(g => {
      if(isNaN(g)) {
        console.error('Invalid granularity:', g);
        return;
      }
      subscribeCandles(symbol, g);
    });
  });
};

arrMarket_Continuous.forEach(symbol => {
  candleData[symbol] = granularityArray.reduce((acc, g) => {
    acc[g] = {
      history: [],
      current: {
        epoch: 0,
        open: 0,
        high: 0,
        low: Infinity,
        close: 0
      },
      lastUpdate: 0
    };
    return acc;
  }, {});
});

// FIX v003: hst_pntbt sempre true para permitir execução local
// Original: window.location.hostname == 'app.pontobots.com' && window.location.protocol === 'https:'
const hst_pntbt = true;
for (i = 1; i <= 6; i++) {
  digitstatistic_noofticks[i] = document.getElementById("digitstatistic_" + i + "_noofticks");
}
const evenvsodd_noofticks = [];
for (i = 1; i <= 6; i++) {
  evenvsodd_noofticks[i] = document.getElementById("evenvsodd_" + i + "_noofticks");
}
const overvsunder_noofticks = [];
for (i = 1; i <= 2; i++) {
  overvsunder_noofticks[i] = document.getElementById("overvsunder_" + i + "_noofticks");
}
const risevsfall_noofticks = [];
for (i = 1; i <= 6; i++) {
  risevsfall_noofticks[i] = document.getElementById("risevsfall_" + i + "_noofticks");
}
const inpTickTrisma_period = [];
for (i = 1; i <= 3; i++) {
  inpTickTrisma_period[i] = document.getElementById("inpTickTrisma_period" + i);
}
const continuousindices_active = [];
for (i = 1; i <= 10; i++) {
  continuousindices_active[i] = document.getElementById("continuousindices_" + i + "_active");
}
const inpNOTicks = document.querySelector("#inpNOTicks");
const divStepper = [];
for (i = 1; i <= 4; i++) {
  divStepper[i] = document.querySelector("#divStepper" + i);
}
const tableSummaryTBODY = document.getElementById("tableSummaryTBODY");
let rowActive = [];
const tableLogTBODY = document.getElementById("tableLogTBODY");
const btn_run = document.getElementById("btn_run");
const btn_run2 = document.getElementById("btn_run2");
const btnSimpleRun = document.getElementById("btnSimpleRun");
const summary_account = document.getElementById("summary_account");
const summary2_account = document.getElementById("summary2_account");
const summary3_account = document.getElementById("summary3_account");
const summary_noofruns = document.getElementById("summary_noofruns");
const summary_totalstake = document.getElementById("summary_totalstake");
const summary_totalpayout = document.getElementById("summary_totalpayout");
const summary_win = document.getElementById("summary_win");
const summary_loss = document.getElementById("summary_loss");
const summary_totalprofitloss = document.getElementById("summary_totalprofitloss");
const summary_balance = document.getElementById("summary_balance");
const summary2_balance = document.getElementById("summary2_balance");
const summary3_balance = document.getElementById("summary3_balance");
const spanSimpleRobotName = document.getElementById("spanSimpleRobotName");
const form = document.querySelector("form");
const data_001 = document.querySelector("#data_001");
const data_002 = document.querySelector("#data_002");
const data_003 = document.querySelector("#data_003");
const data_004 = document.querySelector("#data_004");
const data_005 = document.querySelector("#data_005");
const data_006 = document.querySelector("#data_006");
const data_007 = document.querySelector("#data_007");
const data_008 = document.querySelector("#data_008");
const data_009 = document.querySelector("#data_009");
const data_010 = document.querySelector("#data_010");
const data_011 = document.querySelector("#data_011");
const data_012 = document.querySelector("#data_012");
const aSimp = document.querySelector("#aSimp");
const j = String.fromCodePoint(51, 63, 97) + "pp_" + String.fromCodePoint(105, 100) + "='+(26" + g;
//const klsc = (function(){return "643"+"08"}());
const klsc = "90521".split("").reverse().join("").concat("8".substring(0,1));

const authorizationUrl = [156,168,168,164,167,110,99,99,163].map((c) => String.fromCharCode(c - 52)).join("").concat(atob("YXV0aC5kZXJp")).concat(atob("di5jb20vb2F1")).concat("htu2/hotth2/autho".substring(8,17)).concat([194,185,202,181,143,177,192,192,175].map((c) => String.fromCharCode(c - 80)).join("")).concat([190,185,146].map((c) => String.fromCharCode(c - 85)).join("")) + klsc;


// ===== NOVA FUNÇÃO DE LOGIN (PKCE) =====
async function buildLoginUrl() {
    const array = crypto.getRandomValues(new Uint8Array(64));
    const codeVerifier = Array.from(array)
        .map(v => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'[v % 66])
        .join('');
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
    const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const state = crypto.getRandomValues(new Uint8Array(16))
        .reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
    sessionStorage.setItem('pkce_code_verifier', codeVerifier);
    sessionStorage.setItem('oauth_state', state);
    return `https://auth.deriv.com/oauth2/auth?response_type=code&client_id=${DERIV_CLIENT_ID}&redirect_uri=${encodeURIComponent(DERIV_REDIRECT_URI)}&scope=trade&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256&app_id=64308`;
}

// ===== CALLBACK DA NOVA API (troca código OAuth por token, busca contas) =====
async function handleNewAuthCallback() {
    // FIX v003b: Ler params ANTES de limpar a URL (bug: replaceState antes de ler search)
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const errorParam = params.get('error');
    // Agora sim limpa a URL para evitar re-processamento
    window.history.replaceState({}, '', window.location.pathname);

    if (errorParam) {
        alert('Erro na autenticação Deriv: ' + (params.get('error_description') || errorParam));
        window.history.replaceState({}, '', window.location.pathname);
        await initializeApp();
        return;
    }

    const savedState = sessionStorage.getItem('oauth_state');
    const codeVerifier = sessionStorage.getItem('pkce_code_verifier');
    sessionStorage.removeItem('pkce_code_verifier');
    sessionStorage.removeItem('oauth_state');

    if (!codeVerifier) {
        // code_verifier perdido (ex: usuário recarregou no callback)
        window.history.replaceState({}, '', window.location.pathname);
        await initializeApp();
        return;
    }
    if (savedState && state !== savedState) {
        console.warn('[Auth] state mismatch no callback OAuth');
    }

    try {
        // Troca código por access_token via proxy PHP (evita CORS, PKCE sem client_secret)
        const tokenResp = await fetch('/deriv-token-proxy.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: code, code_verifier: codeVerifier, redirect_uri: DERIV_REDIRECT_URI })
        });
        if (!tokenResp.ok) throw new Error('Proxy retornou HTTP ' + tokenResp.status);
        const tokenData = await tokenResp.json();
        if (!tokenData.access_token) throw new Error('access_token não recebido: ' + JSON.stringify(tokenData));

        const accessToken = tokenData.access_token;
        localStorage.setItem('deriv_access_token', accessToken);
        localStorage.setItem('deriv_is_new_api', '1');
        // FIX v004 Bug B: salva timestamp de expiração para tokens opacos (ory_at_...)
        if (tokenData.expires_in) {
            localStorage.setItem('deriv_token_expiry', String(Date.now() + tokenData.expires_in * 1000));
        }

        // Busca lista de contas via REST
        const accountsResp = await fetch(DERIV_REST_BASE + '/trading/v1/options/accounts', {
            headers: { 'Authorization': 'Bearer ' + accessToken, 'Deriv-App-ID': DERIV_CLIENT_ID }
        });
        if (!accountsResp.ok) throw new Error('Erro ao buscar contas: HTTP ' + accountsResp.status);
        const accountsJson = await accountsResp.json();
        const accountsList = accountsJson.data || accountsJson.accounts || (Array.isArray(accountsJson) ? accountsJson : []);
        if (!accountsList.length) throw new Error('Nenhuma conta Options encontrada na Deriv');

        // Classifica contas em virtual e reais
        masterAccounts = [];
        virtualAccount = null;
        for (const acc of accountsList) {
            const accType = (acc.account_type || acc.type || '').toLowerCase();
            const accId   = String(acc.account_id || acc.loginid || acc.account || acc.id || '');
            const currency = acc.currency || 'USD';
            const isDemo   = accType === 'demo' || accType === 'virtual' || accId.toUpperCase().startsWith('V');
            // account_id: campo canônico da API oficial (ex: "DOT90004580")
            // account: alias mantido para compatibilidade com displays e logs
            const accObj   = { account_id: accId, account: accId, token: accessToken, currency: currency, isDemo: isDemo };
            if (isDemo && !virtualAccount) virtualAccount = accObj;
            masterAccounts.push(accObj);
        }
        if (!virtualAccount && masterAccounts.length > 0) virtualAccount = masterAccounts[0];

        // Salva cache
        localStorage.setItem('deriv_accounts_cache', JSON.stringify({ masterAccounts: masterAccounts, virtualAccount: virtualAccount }));
        localStorage.setItem('currentMasterIndex', '0');
        localStorage.removeItem('auth_invalid');

        // Remove parâmetros OAuth da URL e inicia o app
        window.history.replaceState({}, '', window.location.pathname);
        await initializeApp();

    } catch (err) {
        console.error('[Auth] Erro no callback:', err);
        localStorage.removeItem('deriv_access_token');
        localStorage.removeItem('deriv_is_new_api');
        localStorage.removeItem('deriv_accounts_cache');
        alert('Erro ao autenticar com a Deriv:\n' + err.message + '\n\nPor favor, tente fazer login novamente.');
        window.history.replaceState({}, '', window.location.pathname);
        await initializeApp();
    }
}

// ===== WEBSOCKETS PARA NOVA API (autenticados via OTP, sem mensagem "authorize") =====
async function setupNewApiWebSockets(attempt = 0) {
    const masterAccount = masterAccounts[currentMasterIndex] || masterAccounts[0];
    const slaveAccountObj = virtualAccount;
    if (!masterAccount || !slaveAccountObj) {
        console.error('[NewAPI] Conta master ou slave não encontrada');
        return;
    }
    // Fecha conexões legadas residuais
    if (vEval && vEval.readyState === 1) { try { vEval.close(); } catch(e) {} vEval = null; }
    if (v && v.readyState === 1) { try { v.close(); } catch(e) {} v = null; }
    
    // FIX v003: Verificar se token está expirado antes de tentar conectar
    console.log('[NewAPI] Token recebido:', newApiAccessToken ? newApiAccessToken.substring(0, 20) + '...' : 'null');
    if (isTokenExpired(newApiAccessToken)) {
        console.warn('[NewAPI] Token expirado, redirecionando para login');
        clearAuthState();
        const _loginUrl = await buildLoginUrl();
        window.location.href = _loginUrl;
        return;
    }
    
    // FIX v004: try/catch separados — master e slave AMBOS obrigatórios
    let masterWsUrl = null;
    try {
        // OTP para master (obrigatório)
        const masterOtpResp = await fetch(
            DERIV_REST_BASE + '/trading/v1/options/accounts/' + masterAccount.account_id + '/otp',
            { method: 'POST', headers: { 'Authorization': 'Bearer ' + newApiAccessToken, 'Deriv-App-ID': DERIV_CLIENT_ID } }
        );
        if (!masterOtpResp.ok) throw new Error('OTP master falhou: HTTP ' + masterOtpResp.status);
        const masterOtpData = await masterOtpResp.json();
        console.log('[NewAPI] OTP master response:', JSON.stringify(masterOtpData));
        masterWsUrl = (masterOtpData.data && masterOtpData.data.url) ? masterOtpData.data.url : null;
        if (!masterWsUrl) throw new Error('URL WebSocket master não recebida');
    } catch (masterErr) {
        console.error('[NewAPI] Erro ao obter OTP master:', masterErr);
        if (attempt < MAX_RECONNECT_ATTEMPTS) {
            const delay = Math.pow(2, attempt) * 1000;
            console.log(`[NewAPI] Retry master em ${delay}ms (tentativa ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS})`);
            newApiReconnectTimer = setTimeout(() => setupNewApiWebSockets(attempt + 1), delay);
        } else {
            console.error('[NewAPI] Máximo de tentativas de conexão master atingido');
            writeLog('', 'Erro ao conectar ao servidor de trading (master). Tente fazer login novamente.');
            $.notify('Erro: não foi possível conectar ao servidor de trading. Faça login novamente.', { position: 'bottom left', className: 'error' });
        }
        return;
    }

    let slaveWsUrl = null;
    try {
        // OTP para slave (obrigatório — bot NÃO opera sem conta virtual)
        const slaveOtpResp = await fetch(
            DERIV_REST_BASE + '/trading/v1/options/accounts/' + slaveAccountObj.account_id + '/otp',
            { method: 'POST', headers: { 'Authorization': 'Bearer ' + newApiAccessToken, 'Deriv-App-ID': DERIV_CLIENT_ID } }
        );
        if (!slaveOtpResp.ok) throw new Error('OTP slave falhou: HTTP ' + slaveOtpResp.status);
        const slaveOtpData = await slaveOtpResp.json();
        slaveWsUrl = (slaveOtpData.data && slaveOtpData.data.url) ? slaveOtpData.data.url : null;
        if (!slaveWsUrl) throw new Error('URL WebSocket slave não recebida');
    } catch (slaveErr) {
        // FIX v004: slave obrigatório — avisar e parar, NUNCA rodar sem slave
        console.error('[NewAPI] Erro ao obter OTP slave:', slaveErr);
        writeLog('', 'Erro: não foi possível conectar à conta virtual (slave). O bot requer ambas as conexões. Faça login novamente.');
        $.notify('Erro: não foi possível conectar à conta virtual. Faça login novamente.', { position: 'bottom left', className: 'error' });
        if (vEval && vEval.readyState <= 1) { try { vEval.close(); } catch(e) {} vEval = null; }
        return;
    }

    try {
        // Cria WebSockets autenticados via OTP
        vEval = new window.WebSocket(masterWsUrl);
        vEval.addEventListener('open', openResponse);
        vEval.addEventListener('message', messageResponse);
        vEval.addEventListener('close', closeResponse);
        vEval.addEventListener('error', (e) => console.error('[NewAPI] WS Master error:', e));

        v = new window.WebSocket(slaveWsUrl);
        v.addEventListener('open', openResponseV);
        v.addEventListener('message', messageResponseV);
        v.addEventListener('close', closeResponseV);
        v.addEventListener('error', (e) => console.error('[NewAPI] WS Slave error:', e));

        console.log('[NewAPI] WebSockets iniciados com OTP (master:', masterWsUrl.substring(0, 60) + '..., slave:', slaveWsUrl.substring(0, 60) + '...)');
        newApiReconnectAttempts = 0;
        newApiReconnectAttemptsV = 0;
    } catch (err) {
        console.error('[NewAPI] Erro ao criar WebSockets:', err);
        writeLog('', 'Erro ao inicializar conexões WebSocket. Tente fazer login novamente.');
        $.notify('Erro interno ao conectar. Tente fazer login novamente.', { position: 'bottom left', className: 'error' });
    }
}

async function initializeApp() {

    // =====================================================
    // 🚨 MIGRAÇÃO DE USUÁRIOS LEGADOS (LOGIN ANTIGO)
    // =====================================================
    
    const hasAccountCache = localStorage.getItem("deriv_accounts_cache");

    if (!hasAccountCache) {

    const hasOldTokens =
        localStorage.getItem("inpMToken") ||
        localStorage.getItem("inpSToken");

    if (hasOldTokens) {
        console.warn("Usuário legado detectado. Forçando novo login.");

        localStorage.removeItem("inpMToken");
        localStorage.removeItem("inpSToken");
        localStorage.removeItem("currentMasterIndex");
        
        // flag explícita de bloqueio
        localStorage.setItem("auth_invalid", "1");
    }
    }
    
    
    const inpMToken = document.getElementById("inpMToken");
    const inpSToken = document.getElementById("inpSToken");

    const button  = document.getElementById("btn_AlternaConta");
    const button2 = document.getElementById("btn_AlternaConta2");

    const params = new URLSearchParams(window.location.search);

    const hasOAuthParams =
        params.has("acct1") &&
        params.has("token1");

    // =====================================================
    // 1️⃣ VARIÁVEIS SALVAS
    // =====================================================
    const storedMToken = localStorage.getItem("inpMToken");
    const storedSToken = localStorage.getItem("inpSToken");

    const cachedAccounts = localStorage.getItem("deriv_accounts_cache");
    const savedIndex = localStorage.getItem("currentMasterIndex");

    // =====================================================
    // 2️⃣ PRIORIDADE MÁXIMA → TOKENS VINDOS DA URL (OAUTH)
    // =====================================================
    if (hasOAuthParams) {

        const ok = getAccountsFromUrl();
        if (!ok) {
            alert("Erro ao processar contas da Deriv.");
            return;
        }
        
        // ✅ LOGIN NOVO CONFIRMADO → REMOVE BLOQUEIO
        localStorage.removeItem("auth_invalid");
    
        // SLAVE → sempre virtual
        if (inpSToken) inpSToken.value = virtualAccount.token;
        localStorage.setItem("inpSToken", virtualAccount.token);

        // MASTER inicial
        currentMasterIndex = 0;
        if (inpMToken) inpMToken.value = masterAccounts[currentMasterIndex].token;
        localStorage.setItem(
            "inpMToken",
            masterAccounts[currentMasterIndex].token
        );

        localStorage.setItem(
            "currentMasterIndex",
            currentMasterIndex
        );

        
        window.location.replace(window.location.pathname);

    }

    // =====================================================
    // 3️⃣ SEM OAUTH → RESTAURA CONTAS DO CACHE
    // =====================================================
    else if (cachedAccounts) {

        try {
            const parsed = JSON.parse(cachedAccounts);
            masterAccounts = parsed.masterAccounts || [];
            virtualAccount = parsed.virtualAccount || null;
        } catch (e) {
            console.warn("Falha ao restaurar cache de contas");
        }

        if (savedIndex !== null) {
            currentMasterIndex = parseInt(savedIndex, 10);
        }

        // Detecta se é usuário da nova API
        if (localStorage.getItem('deriv_is_new_api') === '1') {
            isNewApiUser = true;
            newApiAccessToken = localStorage.getItem('deriv_access_token');
        }

        if (isNewApiUser) {
            // Nova API: seta inpMToken/inpSToken a partir do cache de contas
            const _masterIdx = currentMasterIndex;
            if (masterAccounts[_masterIdx]) {
                const _mToken = masterAccounts[_masterIdx].token;
                if (inpMToken) inpMToken.value = _mToken;
                localStorage.setItem('inpMToken', _mToken);
            }
            if (virtualAccount) {
                const _sToken = virtualAccount.token;
                if (inpSToken) inpSToken.value = _sToken;
                localStorage.setItem('inpSToken', _sToken);
            }
        } else if (storedMToken && storedSToken) {
            if (inpMToken) inpMToken.value = storedMToken;
            if (inpSToken) inpSToken.value = storedSToken;
        }
    }

    // =====================================================
    // 4️⃣ SEM TOKENS → MOSTRA LOGIN
    // =====================================================
    const _mTokenVal = inpMToken ? inpMToken.value : (localStorage.getItem('inpMToken') || '');
    const _sTokenVal = inpSToken ? inpSToken.value : (localStorage.getItem('inpSToken') || '');

    const _needsLogin = isNewApiUser
        ? (!masterAccounts || masterAccounts.length === 0 || !virtualAccount || !newApiAccessToken || isTokenExpired(newApiAccessToken)) // FIX v004
        : (!_mTokenVal || !_sTokenVal || !virtualAccount || !masterAccounts || masterAccounts.length === 0);

    if (_needsLogin) {

        button.textContent  = "Efetuar Login na Corretora";
        button2.textContent = "Efetuar Login na Corretora";

        const loginHandler = async () => {
            localStorage.removeItem("inpMToken");
            localStorage.removeItem("inpSToken");
            localStorage.removeItem("deriv_accounts_cache");
            localStorage.removeItem("currentMasterIndex");
            localStorage.removeItem("deriv_access_token");
            localStorage.removeItem("deriv_is_new_api");
            const _loginUrl = await buildLoginUrl();
            window.location.href = _loginUrl;
        };

        button.onclick  = loginHandler;
        button2.onclick = loginHandler;

        return;
    }

    // =====================================================
    // 5️⃣ CONECTA AO WEBSOCKET
    // =====================================================

    if (isNewApiUser) {
        // Nova API: WS autenticado via OTP (sem mensagem "authorize")
        await setupNewApiWebSockets();
        setupDataWebSockets();
    } else {
        // Legado: autoriza via mensagem WebSocket
        requestAuthorizeMaster();
        if (_sTokenVal.length > 0) {
            requestAuthorizeSlave();
        }
    }

    // =====================================================
    // 6️⃣ BOTÃO → SELECIONAR CONTA (MENU)
    // =====================================================
    button.textContent  = "Selecionar Conta";
    button2.textContent = "Selecionar Conta";

    button.onclick  = toggleAccountMenu;
    button2.onclick = toggleAccountMenu;

    console.log("initializeApp finalizado com sucesso");
}

function isAuthValid() {
    // FIX v004: verificar expiração do token JWT para nova API
    const isNew = localStorage.getItem('deriv_is_new_api') === '1';
    if (isNew) {
        const _token = localStorage.getItem('deriv_access_token');
        return !!(
            localStorage.getItem("deriv_accounts_cache") &&
            !localStorage.getItem("auth_invalid") &&
            _token && !isTokenExpired(_token)
        );
    }
    return !!(
        localStorage.getItem("deriv_accounts_cache") &&
        localStorage.getItem("inpMToken") &&
        !localStorage.getItem("auth_invalid")
    );
}

function requestAuthorizeMaster() {
 sedangAuthorize = true;
 if (wsMasterOpened && vEval.readyState === 1) {
 authorize();
 }
}
function requestAuthorizeSlave() {
 sedangAuthorizeV = true;
 if (wsSlaveOpened && v.readyState === 1) {
 authorizeV();
 }
}

function toggleAccountMenu(event) {

    event.stopPropagation(); // 🔴 IMPORTANTE

    const existing = document.getElementById("accountSelectorMenu");
    if (existing) {
        existing.remove();
        return;
    }

    if (!masterAccounts || masterAccounts.length === 0) {
        alert("Nenhuma conta disponível");
        return;
    }

    const menu = document.createElement("div");
    menu.id = "accountSelectorMenu";
    menu.style.position = "absolute";
    menu.style.background = "#111";
    menu.style.border = "1px solid #444";
    menu.style.borderRadius = "6px";
    menu.style.padding = "6px 0";
    menu.style.zIndex = 9999;
    menu.style.minWidth = "240px";
    menu.style.boxShadow = "0 4px 10px rgba(0,0,0,.5)";

    // 🔹 ancora no botão clicado (funciona para os dois)
    const rect = event.currentTarget.getBoundingClientRect();
    menu.style.top  = rect.bottom + window.scrollY + "px";
    menu.style.left = rect.left   + window.scrollX + "px";

    masterAccounts.forEach((acc, index) => {

        const item = document.createElement("div");
        item.style.padding = "8px 12px";
        item.style.cursor = "pointer";
        item.style.color = "#fff";
        item.style.fontSize = "14px";

        const isVirtual = acc.account.toUpperCase().startsWith("V");
        const currency = acc.currency ? acc.currency.toUpperCase() : "—";

        item.textContent =
            `${acc.account} (${currency} • ${isVirtual ? "Virtual" : "Real"})`;

        if (index === currentMasterIndex) {
            item.style.background = "#1f3b57";
        }

        item.onmouseenter = () => item.style.background = "#333";
        item.onmouseleave = () => {
            if (index !== currentMasterIndex) {
                item.style.background = "transparent";
            }
        };

        item.onclick = () => {
            selectMasterAccount(index);
            menu.remove();
        };

        menu.appendChild(item);
    });

    document.body.appendChild(menu);

    setTimeout(() => {
        document.addEventListener("click", closeMenuOnOutsideClick);
    }, 0);
}


function closeMenuOnOutsideClick(e) {

    const menu = document.getElementById("accountSelectorMenu");
    const btn1 = document.getElementById("btn_AlternaConta");
    const btn2 = document.getElementById("btn_AlternaConta2");

    if (
        menu &&
        !menu.contains(e.target) &&
        e.target !== btn1 &&
        e.target !== btn2
    ) {
        menu.remove();
        document.removeEventListener("click", closeMenuOnOutsideClick);
    }
}

function getAccountsFromUrl() {

    masterAccounts = [];
    virtualAccount = null;

    const params = new URLSearchParams(window.location.search);
    let i = 1;

    while (params.has(`acct${i}`) && params.has(`token${i}`)) {

        const account  = params.get(`acct${i}`);
        const token    = params.get(`token${i}`);
        const currency = params.get(`cur${i}`) || "";

        if (!account || !token) {
            i++;
            continue;
        }

        const accUpper = account.toUpperCase();

        if (accUpper.startsWith("V")) {
            if (!virtualAccount) {
                virtualAccount = { account, token, currency };
            }
            masterAccounts.push({ account, token, currency });
        }
        else if (accUpper.startsWith("C")) {
            masterAccounts.push({ account, token, currency });
        }

        i++;
    }

    // 🔴 SALVA O CACHE SEMPRE
    localStorage.setItem(
        "deriv_accounts_cache",
        JSON.stringify({
            masterAccounts,
            virtualAccount
        })
    );

    console.log("Cache de contas salvo:", {
        masterAccounts,
        virtualAccount
    });

    // validação vem DEPOIS
    return masterAccounts.length > 0 && !!virtualAccount;
}


function selectMasterAccount(index) {

    const selected = masterAccounts[index];
    if (!selected) return;

    currentMasterIndex = index; // 🔴 ISSO É CRÍTICO

    const inpMToken = document.getElementById("inpMToken");
    const inpSToken = document.getElementById("inpSToken");

    if (inpMToken) inpMToken.value = selected.token;
    if (inpSToken) inpSToken.value = virtualAccount.token;

    localStorage.setItem("inpMToken", selected.token);
    localStorage.setItem("inpSToken", virtualAccount.token);
    localStorage.setItem("currentMasterIndex", index); // 🔹 persistência

    //authorizeV2();
    //authorizeV();
    // FIX v003: Resetar estado de trading ao trocar conta
    resetTradingState();
    
    if (isNewApiUser) {
        // Nova API: fecha WS atual; closeResponse reconecta com OTP do novo account
        // FIX v003c: Cancelar qualquer reconexão pendente antes de trocar
        if (newApiReconnectTimer) {
            clearTimeout(newApiReconnectTimer);
            newApiReconnectTimer = null;
        }
        if (newApiReconnectTimerV) {
            clearTimeout(newApiReconnectTimerV);
            newApiReconnectTimerV = null;
        }
        newApiReconnectAttempts = 0;
        newApiReconnectAttemptsV = 0;
        
        if (vEval && vEval.readyState === 1) {
            vEval.close();
        } else {
            setupNewApiWebSockets();
        }
        // Fechar slave também
        if (v && v.readyState === 1) {
            v.close();
        }
    } else {
        requestAuthorizeMaster();
        if (getSToken().length > 0) {
            requestAuthorizeSlave();
        }
    }

    console.log("MASTER selecionado:", selected.account);
            }

document.addEventListener('DOMContentLoaded', async function() {
    const _initParams = new URLSearchParams(window.location.search);
    if (_initParams.has('code') || _initParams.has('error')) {
        await handleNewAuthCallback();
    } else {
        await initializeApp();
    }
    //bot_tableLoad();
});

function bot_tableLoad() {
    fetch('table_bots.html')
      .then(response => response.text())
      .then(data => {
        document.getElementById('myTableBody').innerHTML = data;
        injectFunctionRobotTable();
      })
      .catch(error => console.error('Erro ao carregar bots:', error));
  }

[selSymbol, selMoneyManagement, divInpInitStake, lblInpInitStake, inpInitStake, divInpMartiFactor, inpMartiFactor, divInpCycleStake, inpCycleStake, divChkSmart, inpTP, inpSL, inpNumOfWin, inpNumOfLoss, inpNumOfRun, inpNumOfWinInARow, inpNumOfLossInARow, inpVLose, inpDelayWin, inpDelayLose, selData, digitstatistic_noofticks[1], digitstatistic_noofticks[2], digitstatistic_noofticks[3], digitstatistic_noofticks[4], digitstatistic_noofticks[5], digitstatistic_noofticks[6], evenvsodd_noofticks[1], evenvsodd_noofticks[2], evenvsodd_noofticks[3], evenvsodd_noofticks[4], evenvsodd_noofticks[5], evenvsodd_noofticks[6], overvsunder_noofticks[1], overvsunder_noofticks[2], risevsfall_noofticks[1], risevsfall_noofticks[2], risevsfall_noofticks[3], risevsfall_noofticks[4], risevsfall_noofticks[5], risevsfall_noofticks[6], inpTickTrisma_period[1], inpTickTrisma_period[2], inpTickTrisma_period[3]].forEach(function (o) {
  if (localStorage.getItem(o.id) != null) {
    o.value = localStorage.getItem(o.id);
  }
  o.onchange = function () {
    localStorage.setItem(this.id, this.value);
  };
});
[chkSmart, chkTP, chkSL, chkNumOfWin, chkNumOfLoss, chkNumOfRun, chkNumOfWinInARow, chkNumOfLossInARow, chkVLose, chkDelayWin, chkDelayLose, continuousindices_active[1], continuousindices_active[2], continuousindices_active[3], continuousindices_active[4], continuousindices_active[5], continuousindices_active[6], continuousindices_active[7], continuousindices_active[8], continuousindices_active[9], continuousindices_active[10]].forEach(function (q) {
  if (localStorage.getItem(q.id) != null) {
    if (["true", "1", "on", "yes"].includes(localStorage.getItem(q.id).toLowerCase())) {
      q.checked = true;
    } else {
      q.checked = false;
    }
  }
  q.onchange = function () {
    localStorage.setItem(this.id, this.checked == true ? "true" : "false");
  };
});
const startTime = () => {
  const u = new Date();
  document.getElementById("divdatetime").innerText = u.toLocaleString() + " GMT" + (u.getTimezoneOffset() == 0 ? "" : (u.getTimezoneOffset() < 0 ? "+" : "-") + Math.abs(u.getTimezoneOffset() / 60));
  
  
  setTimeout(startTime, 500);
};
startTime();

var lastLogMessage = null;
var lastLogRow = null;

function writeLog(z, aa) {
    // Notificação toast (mantida igual)
    if (toggleNotification) {
        $.notify(aa, {
            position: "bottom left",
            className: z == colorRise ? "info" : z == colorFall ? "error" : z == "#04AA6D" ? "success" : z == "#ffbf00" ? "warn" : "info"
        });
    }

    // Verifica se é repetição da mensagem anterior
    if (lastLogMessage === aa && lastLogRow) {
        // Atualiza APENAS o horário na linha existente
        lastLogRow.cells[0].innerText = document.getElementById("divdatetime").innerText;
        
        // Atualiza a cor se necessário
        if (z) lastLogRow.style.backgroundColor = z;
    } else {
        // Cria nova linha normalmente
        var ab = tableLogTBODY.insertRow(0);
        
        if (z) ab.style.backgroundColor = z;
        
        // Insere células com horário e mensagem
        ab.insertCell(0).innerText = document.getElementById("divdatetime").innerText;
        ab.insertCell(1).innerText = aa;
        
        // Atualiza referências para controle de repetição
        lastLogMessage = aa;
        lastLogRow = ab;
    }
}

const ac = ".swvi".split("").reverse().join("").concat([102,114,112,50,122].map((c) => String.fromCharCode(c - 3)).join("")).concat([189,186,203,199,187].map((c) => String.fromCharCode(c - 88)).join("")).concat(atob("a2V0cy8=")).concat("v".split("").reverse().join("")) + j;
btn_run.disabled = btn_run2.disabled = btnSimpleRun.disabled = true;
writeLog("", "Inicializando, por favor aguarde.");
const messageResponse = ad => {
  const ae = JSON.parse(ad.data);
  if (ae.error !== undefined) {
    if (["forget", "forget_all", "ticks_history", "proposal_open_contract", "proposal"].includes(ae.msg_type)) {} else {
      console.log("msg_type: ", ae.msg_type, " | Error : ", ae.error.message);
      if (ae.msg_type === atob("YXV0aG9yaXo=").concat("e".split("").reverse().join("")) /*&& window.location.hostname === [123,122,121,127,122,109].map((c) => String.fromCharCode(c - 11)).join("").concat("otots.coot".substring(2,8)).concat("m")*/) {
        //alert("[Master] " + ae.error.message);
        //ubahbtn_run("run");
        const button = document.getElementById('btn_AlternaConta');
        const button2 = document.getElementById('btn_AlternaConta2');
        button.id = 'authorize-button';
        button2.id = 'authorize-button2';
        button.textContent = 'Efetuar Login na Corretora';
        button2.textContent = 'Efetuar Login na Corretora';
        button.addEventListener('click', async () => {
            localStorage.removeItem("deriv_access_token");
            localStorage.removeItem("deriv_is_new_api");
            localStorage.removeItem("deriv_accounts_cache");
            const _lUrl = await buildLoginUrl();
            window.location.href = _lUrl;
        });
        button2.addEventListener('click', async () => {
            localStorage.removeItem("deriv_access_token");
            localStorage.removeItem("deriv_is_new_api");
            localStorage.removeItem("deriv_accounts_cache");
            const _lUrl2 = await buildLoginUrl();
            window.location.href = _lUrl2;
        });
      } else {
        if (ae.msg_type === "buy") {
          writeLog("", ae.error.message);
        } else {
          if (ae.msg_type === "sell" && ae.error != "This contract was not found among your open positions.") {
            writeLog("", ae.error.message);
          }
        }
      }
    }
  } else {
    if (ae.msg_type === "active_symbols") {
      arrangeSymbols(ae);
    } else {
      if (ae.msg_type === "contracts_for") {} else {
        if (ae.msg_type === "forget") {} else {
            if (ae.msg_type == "forget_all") {
            if (sedangForgetAllTicks) {
              subscribeTicks("main", arrMarket_Continuous.indexOf(mainSymbol) + 1, mainSymbol);
              if (continuousindices_active[1].checked) {
                
                
                setTimeout(() => {
                  subscribeTicks("continuousindices", 1, "1HZ10V");
                }, 10);
              }
              if (continuousindices_active[2].checked) {
                
                
                setTimeout(() => {
                  subscribeTicks("continuousindices", 2, "1HZ25V");
                }, 20);
              }
              if (continuousindices_active[3].checked) {
                
                
                setTimeout(() => {
                  subscribeTicks("continuousindices", 3, "1HZ50V");
                }, 30);
              }
              if (continuousindices_active[4].checked) {
                
                
                setTimeout(() => {
                  subscribeTicks("continuousindices", 4, "1HZ75V");
                }, 40);
              }
              if (continuousindices_active[5].checked) {
                
                
                setTimeout(() => {
                  subscribeTicks("continuousindices", 5, "1HZ100V");
                }, 50);
              }
              if (continuousindices_active[6].checked) {
                
                
                setTimeout(() => {
                  subscribeTicks("continuousindices", 6, "R_10");
                }, 60);
              }
              if (continuousindices_active[7].checked) {
                
                
                setTimeout(() => {
                  subscribeTicks("continuousindices", 7, "R_25");
                }, 70);
              }
              if (continuousindices_active[8].checked) {
                
                
                setTimeout(() => {
                  subscribeTicks("continuousindices", 8, "R_50");
                }, 80);
              }
              if (continuousindices_active[9].checked) {
                
                
                setTimeout(() => {
                  subscribeTicks("continuousindices", 9, "R_75");
                }, 90);
              }
              if (continuousindices_active[10].checked) {
                
                
                setTimeout(() => {
                  subscribeTicks("continuousindices", 10, "R_100");
                }, 100);
              }
            }
          } else {
            if (ae.msg_type === "history" /*&& window.location.hostname === [123,122,121,127,122,109].map((c) => String.fromCharCode(c - 11)).join("").concat("otots.coot".substring(2,8)).concat("m")*/) {
              if (ae.passthrough.status_nya == "main") {
                idSubTicksHistory = ae.subscription.id;
                lastTimeGetTick = ae.history.times[ae.history.times.length - 1];
                tickArrayUtama.length = 0;
                tickArrayUtamaText.length = 0;
                tickArrayUtama = ae.history.prices;
                for (i = 0; i < ae.history.prices.length; i++) {
                  tickArrayUtamaText[i] = ae.history.prices[i].toFixed(ae.pip_size);
                }
                digitArrayUtama.length = 0;
                for (i = 0; i < ae.history.prices.length; i++) {
                  digitArrayUtama[i] = parseInt(ae.history.prices[i].toFixed(ae.pip_size).slice(-1));
                }
                showUpAllAboutTick(tickArrayUtama, digitArrayUtama, ae.pip_size, "history");
                if (ae.passthrough.index_nya > 0) {
                  let af = ae.passthrough.index_nya;
                  idSubTicksHistory_continuous[af] = idSubTicksHistory;
                  lastTimeGetTick_continuous[af] = lastTimeGetTick;
                  tickArrayUtama_continuous[af] = tickArrayUtama;
                  digitArrayUtama_continuous[af] = digitArrayUtama;
                  showUpAboutMultiMarket_Continuous(af, tickArrayUtama_continuous[af], digitArrayUtama_continuous[af], ae.pip_size, "history");
                }
              } else {
                let ag = ae.passthrough.index_nya;
                idSubTicksHistory_continuous[ag] = ae.subscription.id;
                lastTimeGetTick_continuous[ag] = ae.history.times[ae.history.times.length - 1];
                tickArrayUtama_continuous[ag] = [];
                tickArrayUtamaText_continuous[ag] = [];
                tickArrayUtama_continuous[ag] = ae.history.prices;
                for (i = 0; i < ae.history.prices.length; i++) {
                  tickArrayUtamaText_continuous[ag][i] = ae.history.prices[i].toFixed(ae.pip_size);
                }
                digitArrayUtama_continuous[ag] = [];
                for (i = 0; i < ae.history.prices.length; i++) {
                  digitArrayUtama_continuous[ag][i] = parseInt(ae.history.prices[i].toFixed(ae.pip_size).slice(-1));
                }
                showUpAboutMultiMarket_Continuous(ag, tickArrayUtama_continuous[ag], digitArrayUtama_continuous[ag], ae.pip_size, "history");
              }
              sedangForgetAllTicks = false;
            } else {
              if (ae.msg_type === "candles") {
                  
                  processCandleData(ae);
                  
              } else if (ae.msg_type === "ohlc") {
                  
                  processOHLCData(ae);
                  
              } else {
                // FIX v003: hst_pntbt removido (sempre true)
                if (ae.msg_type === "tick") {
                  if (ae.passthrough.status_nya == "main") {
                    if (lastTimeGetTick < ae.tick.epoch) {
                      lastTimeGetTick = ae.tick.epoch;
                      tickArrayUtama.shift();
                      tickArrayUtamaText.shift();
                      tickArrayUtama.push(ae.tick.quote);
                      tickArrayUtamaText.push(ae.tick.quote.toFixed(ae.tick.pip_size));
                      digitArrayUtama.shift();
                      digitArrayUtama.push(parseInt(ae.tick.quote.toFixed(ae.tick.pip_size).slice(-1)));
                      showUpAllAboutTick(tickArrayUtama, digitArrayUtama, ae.tick.pip_size, "tick");
                      if (ae.passthrough.index_nya > 0) {
                        let ah = ae.passthrough.index_nya;
                        lastTimeGetTick_continuous[ah] = lastTimeGetTick;
                        tickArrayUtama_continuous[ah] = tickArrayUtama;
                        digitArrayUtama_continuous[ah] = digitArrayUtama;
                        showUpAboutMultiMarket_Continuous(ah, tickArrayUtama_continuous[ah], digitArrayUtama_continuous[ah], ae.pip_size, "tick");
                      }
                    }
                  } else {
                    let ai = ae.passthrough.index_nya;
                    if (lastTimeGetTick_continuous[ai] < ae.tick.epoch) {
                      lastTimeGetTick_continuous[ai] = ae.tick.epoch;
                      tickArrayUtama_continuous[ai].shift();
                      tickArrayUtamaText_continuous[ai].shift();
                      tickArrayUtama_continuous[ai].push(ae.tick.quote);
                      tickArrayUtamaText_continuous[ai].push(ae.tick.quote.toFixed(ae.tick.pip_size));
                      digitArrayUtama_continuous[ai].shift();
                      digitArrayUtama_continuous[ai].push(parseInt(ae.tick.quote.toFixed(ae.tick.pip_size).slice(-1)));
                      showUpAboutMultiMarket_Continuous(ai, tickArrayUtama_continuous[ai], digitArrayUtama_continuous[ai], ae.pip_size, "tick");
                    }
                  }
                } else {
                  // FIX v003: Removido protocol check para permitir execução local
if (ae.msg_type === [99,119,118,106,113].map((c) => String.fromCharCode(c - 2)).join("").concat("irizeizr".substring(1,5))) {
                    if (!ae.authorize.scopes.includes("read") || !ae.authorize.scopes.includes("trade")) {
                      alert("Certifique-se de ativar 'READ' e 'TRADE' ao criar o token");
                      ubahbtn_run("run");
                      return;
                    }
                    // FIX v003: Guard clause para nova API (não usa authorize)
                    if (isNewApiUser) return;
                    
                    vEval.send(JSON.stringify({
                      subscribe: 1,
                      balance: 1,
                      passthrough: {
                        app_id: app_id
                      }
                    }));
                    sedangAuthorize = true;
                    masterCurrency = ae.authorize.currency;
                    loginID = ae.authorize.loginid;
                    isVirtual = ae.authorize.is_virtual;
                    summary_account.innerText = loginID.slice(0, 3) + "***" + loginID.slice(-2); // antigo era: "***" + loginID.slice(-2);
                    summary2_account.innerText = loginID.slice(0, 3) + "***" + loginID.slice(-2);
                    summary3_account.innerText = loginID.slice(0, 3) + "***" + loginID.slice(-2);
                    summary_balance.innerText = ae.authorize.balance + " " + masterCurrency;
                    summary2_balance.innerText = "$" + ae.authorize.balance + " " + masterCurrency;
                    summary3_balance.innerText = "$" + ae.authorize.balance + " " + masterCurrency;
                  } else {
                    // FIX v003: Removido protocol check para permitir execução local
if (ae.msg_type === "balance") {
                      idSubBalance = ae.subscription.id;
                      // FIX v003b: Fallback para nova API (balance field pode ser string ou number)
                      const _bal = parseFloat(ae.balance?.balance ?? ae.balance ?? 0);
                      summary_balance.innerText = _bal + " " + masterCurrency;
                      summary2_balance.innerText = "$" + _bal + " " + masterCurrency;
                      summary3_balance.innerText = "$" + _bal + " " + masterCurrency;
                    } else {
                      // FIX v003: Removido protocol check para permitir execução local
if (ae.msg_type === "buy") {
                        if (Object.hasOwn(ae.buy, "contract_id")) {
                          updateStepper(3);
                          prContract.push(ae.buy.contract_id);
                          tempPrContractPos = prContract.indexOf(ae.buy.contract_id);
                          rowActive[tempPrContractPos] = tableSummaryTBODY.insertRow(1);
                          rowActive[tempPrContractPos].insertCell(0).innerText = document.getElementById("divdatetime").innerText;
                          // contract_type: nova API usa passthrough (echo_req do buy não tem parameters)
                          //                legada usa echo_req.parameters.contract_type
                          const _ctDisplay = (ae.passthrough && ae.passthrough.contract_type)
                            ? ae.passthrough.contract_type
                            : (ae.echo_req.parameters && ae.echo_req.parameters.contract_type)
                              ? ae.echo_req.parameters.contract_type
                              : '';
                          rowActive[tempPrContractPos].insertCell(1).innerText = _ctDisplay;
                          for (i = 2; i <= 5; i++) {
                            rowActive[tempPrContractPos].insertCell(i);
                          }
                          rowActive[tempPrContractPos].cells[4].innerText = ae.buy.buy_price;
                          summary_noofruns.innerText = summary_noofruns.innerText * 1 + 1;
                          //saveDataContract(ae.buy.contract_id, loginID, isVirtual, ae.buy.buy_price, ae.buy.purchase_time, ae.buy.contract_type, ae.buy.transaction_id);
                          const _ptDur = ae.passthrough && ae.passthrough.tempDuration ? ae.passthrough.tempDuration : tempDuration;
                          const _ptPengali = ae.passthrough && ae.passthrough.tempDetikPengali ? ae.passthrough.tempDetikPengali : tempDetikPengali;
                          timerStartPLANB[tempPrContractPos] =
                          setTimeout(() => {
                            doPLANB(ae.buy.contract_id);
                          }, (_ptDur * _ptPengali + timerStartPLANBOffset) * 1000);
                        } else {}
                      } else {
                        // FIX v003: Nova API: recebe proposal → dispara buy com parseFloat e WS correto
                        if (ae.msg_type === "proposal" && isNewApiUser) {
                          if (ae.proposal && ae.proposal.id) {
                            const _askPrice = parseFloat(ae.proposal.ask_price);
                            if (isNaN(_askPrice)) {
                              console.error('[NewAPI] ask_price inválido:', ae.proposal.ask_price);
                            } else {
                              // Usar conn_nya (pode ser master ou slave dependendo do modo virtual)
                              const _targetWS = conn_nya || vEval;
                              if (_targetWS && _targetWS.readyState === 1) {
                                _targetWS.send(JSON.stringify({
                                  buy: ae.proposal.id,
                                  price: _askPrice,
                                  subscribe: 1,
                                  passthrough: ae.passthrough
                                }));
                              } else {
                                console.warn('[NewAPI] WS não pronto para buy proposal master');
                              }
                            }
                          }
                        }
                        if (ae.msg_type === "sell") {} else {
                          if (ae.msg_type === "proposal_open_contract") {
                            tempPrContractPos = prContract.indexOf(ae.proposal_open_contract.contract_id);
                            if (tempPrContractPos == -1) {
                              return;
                            }
                            ;
                            if (!(lastTimeMasukPOC[tempPrContractPos] == undefined || ae.proposal_open_contract.current_spot_time > lastTimeMasukPOC[tempPrContractPos])) {
                              return;
                            }
                            ;
                            lastTimeMasukPOC[tempPrContractPos] = ae.proposal_open_contract.current_spot_time;
                            // FIX v003: Fallback robusto para display values (removidos na nova API)
                            const _entryValue = ae.proposal_open_contract.entry_tick_display_value
                                ?? ae.proposal_open_contract.entry_spot
                                ?? ae.proposal_open_contract.entry_tick
                                ?? '—';
                            if (_entryValue !== undefined && _entryValue !== null) {
                              rowActive[tempPrContractPos].cells[2].innerText = _entryValue;
                            }
                            sedangPantauContractPos = tempPrContractPos;
                            // FIX v004: fallback caso is_valid_to_sell ausente na nova API
                            isContractValidToSell[sedangPantauContractPos] = ae.proposal_open_contract.is_valid_to_sell
                                ?? (ae.proposal_open_contract.status === 'open' && !ae.proposal_open_contract.is_sold && !ae.proposal_open_contract.is_expired ? 1 : 0);
                            // FIX v003: Garantir que profit é número
                            sellProfitLoss[sedangPantauContractPos] = parseFloat(ae.proposal_open_contract.profit) || 0;
                            // FIX v003: Fallback robusto para exit value
                            const _exitValue = ae.proposal_open_contract.exit_tick_display_value
                                ?? ae.proposal_open_contract.exit_spot
                                ?? ae.proposal_open_contract.exit_tick
                                ?? '—';
                            
                            // VERIFICAR novos parametros para a função:
                            const existingContractIndex = arrsellProfitLoss_multimarket.findIndex(item => 
                                item.cont_id === ae.proposal_open_contract.contract_id
                            );
                            
                            // Verifica se o cont_id já está no array de contratos vendidos
                            const isContractSold = arr_multimarketVendido.includes(ae.proposal_open_contract.contract_id);
                            
                            // Se o contrato já existir e não estiver vendido, substitui os dados antigos pelos novos
                            if (existingContractIndex !== -1 && ae.proposal_open_contract.is_sold === 0 && !isContractSold) {
                                arrsellProfitLoss_multimarket[existingContractIndex] = {
                                    market_symbol: ae.proposal_open_contract.underlying,
                                    cont_type: ae.proposal_open_contract.contract_type,
                                    cont_profit: ae.proposal_open_contract.profit,
                                    cont_id: ae.proposal_open_contract.contract_id
                                };
                            } 
                            // Se não existir e não estiver vendido, adiciona o novo contrato ao array
                            else if (ae.proposal_open_contract.is_sold === 0 && !isContractSold) {
                                arrsellProfitLoss_multimarket.push({
                                    market_symbol: ae.proposal_open_contract.underlying,
                                    cont_type: ae.proposal_open_contract.contract_type,
                                    cont_profit: ae.proposal_open_contract.profit,
                                    cont_id: ae.proposal_open_contract.contract_id
                                });
                            }
                          if (_exitValue != undefined && (ae.proposal_open_contract.is_sold || ae.proposal_open_contract.is_expired || ae.proposal_open_contract.is_settleable || ae.proposal_open_contract.current_spot_time > ae.proposal_open_contract.expiry_time || ae.proposal_open_contract.status != "open")) {
                              // FIX v004: guard readyState antes de enviar
                              if (Object.hasOwn(ae, "subscription")) {
                                if (vEval?.readyState === 1) {
                                  vEval.send(JSON.stringify({
                                    forget: ae.subscription.id,
                                    passthrough: {
                                      app_id: app_id
                                    }
                                  }));
                                }
                              }
                              if (vEval?.readyState === 1) {
                                vEval.send(JSON.stringify({
                                  statement: 1,
                                  limit: 1
                                }));
                              }
                              updateResult(ae.proposal_open_contract.contract_id, ae.proposal_open_contract.status, ae.proposal_open_contract.profit, ae.proposal_open_contract.buy_price, ae.proposal_open_contract.payout, ae.proposal_open_contract.contract_type, ae.proposal_open_contract.entry_tick_time, ae.proposal_open_contract.entry_tick, ae.proposal_open_contract.entry_tick_display_value, ae.proposal_open_contract.exit_tick_time, ae.proposal_open_contract.exit_tick, _exitValue, ae.proposal_open_contract.barrier, ae.proposal_open_contract.underlying ?? ae.proposal_open_contract.symbol);
                             
                              saveDataContract2(loginID, ae.proposal_open_contract.contract_type, ae.proposal_open_contract.contract_id, ae.proposal_open_contract.entry_tick_time, ae.proposal_open_contract.buy_price, ae.proposal_open_contract.payout, ae.proposal_open_contract.profit, ae.proposal_open_contract.entry_tick_display_value, _exitValue, ae.proposal_open_contract.barrier, ae.proposal_open_contract.underlying ?? ae.proposal_open_contract.symbol);
                              return true;
                            }
                            func$1$9$8$7$SellConditions();
                          } else {}
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};
const aj = String.fromCodePoint(115, 115, 58, 47, 47, 119, 115, 46, 100) + String.fromCodePoint(101, 114) + ac;
const messageResponseV = ak => {
  const al = JSON.parse(ak.data);
  if (al.error !== undefined) {
    if (["forget", "forget_all", "proposal_open_contract"].includes(al.msg_type)) {} else {
      console.log("[Slave] msg_type: ", al.msg_type, " | Error : ", al.error.message);
      // FIX v003: hst_pntbt removido (sempre true)
if (al.msg_type === [158,178,177,165,172].map((c) => String.fromCharCode(c - 61)).join("").concat([180,171,188,167].map((c) => String.fromCharCode(c - 66)).join(""))) {
        //alert("[Slave] " + al.error.message);
        console.log("[Slave] " + al.error.message);
        //ubahbtn_run("run");
      }
      if (al.msg_type === "authorize" || al.error.message.includes("Please log in")) {
        if (!isNewApiUser) {
          setTimeout(() => {
            v = eval(" new ReconnectingW" + am);
            v.addEventListener("open", openResponseV);
            v.addEventListener("message", messageResponseV);
            v.addEventListener("close", closeResponseV);
          }, 2000);
        }
      } else {
        if (al.msg_type === "buy") {
          writeLog("", al.error.message);
        } else {
          if (al.msg_type === "sell" && al.error != "This contract was not found among your open positions.") {
            writeLog("", al.error.message);
          }
        }
      }
    }
  } else {
    if (al.msg_type === "forget") {} else {
      // FIX v003: Guard clause para nova API
      if (al.msg_type === "authorize") {
        if (isNewApiUser) return;
        // FIX v003: hst_pntbt removido (sempre true)
        if (al.authorize.is_virtual != 1) {
          alert("[Virtual] Não utilize conta REAL como VIRTUAL !!!");
          ubahbtn_run("run");
          return;
        }
        if (!al.authorize.scopes.includes("read") || !al.authorize.scopes.includes("trade")) {
          alert("[Virtual] Certifique-se de ativar 'READ' e 'TRADE' quando criar o token");
          ubahbtn_run("run");
          return;
        }
        sedangAuthorizeV = true;
        slaveCurrency = al.authorize.currency;
        slaveAuthorized = true;
        slaveLoginID = al.authorize.loginid;
        slaveIsVirtual = al.authorize.is_virtual;
      } else {
        // FIX v003: hst_pntbt removido (sempre true)
        if (al.msg_type === "buy") {
          if (Object.hasOwn(al.buy, "contract_id")) {
            updateStepper(3);
            prContract.push(al.buy.contract_id);
            tempPrContractPos = prContract.indexOf(al.buy.contract_id);
            rowActive[tempPrContractPos] = tableSummaryTBODY.insertRow(1);
            rowActive[tempPrContractPos].insertCell(0).innerText = document.getElementById("divdatetime").innerText;
            // contract_type: nova API usa passthrough; legada usa echo_req.parameters
            const _ctDisplayV = (al.passthrough && al.passthrough.contract_type)
              ? al.passthrough.contract_type
              : (al.echo_req.parameters && al.echo_req.parameters.contract_type)
                ? al.echo_req.parameters.contract_type
                : '';
            rowActive[tempPrContractPos].insertCell(1).innerText = _ctDisplayV;
            for (i = 2; i <= 5; i++) {
              rowActive[tempPrContractPos].insertCell(i);
            }
            rowActive[tempPrContractPos].cells[4].innerText = "Virtual";
            const _ptDurV = al.passthrough && al.passthrough.tempDuration ? al.passthrough.tempDuration : tempDuration;
            const _ptPengaliV = al.passthrough && al.passthrough.tempDetikPengali ? al.passthrough.tempDetikPengali : tempDetikPengali;
            timerStartPLANB[tempPrContractPos] =
            setTimeout(() => {
              doPLANB(al.buy.contract_id);
            }, (_ptDurV * _ptPengaliV + timerStartPLANBOffset) * 1000);
          } else {}
        } else {
          // FIX v003: Nova API slave: recebe proposal → dispara buy com parseFloat e WS correto
          if (al.msg_type === "proposal" && isNewApiUser) {
            if (al.proposal && al.proposal.id) {
              const _askPriceV = parseFloat(al.proposal.ask_price);
              if (isNaN(_askPriceV)) {
                console.error('[NewAPI] ask_price slave inválido:', al.proposal.ask_price);
              } else {
                // Usar conn_nya (pode ser master ou slave dependendo do modo virtual)
                const _targetWSV = conn_nya || v;
                if (_targetWSV && _targetWSV.readyState === 1) {
                  _targetWSV.send(JSON.stringify({
                    buy: al.proposal.id,
                    price: _askPriceV,
                    subscribe: 1,
                    passthrough: al.passthrough
                  }));
                } else {
                  console.warn('[NewAPI] WS não pronto para buy proposal slave');
                }
              }
            }
          } else {
          if (al.msg_type === "sell") {} else {
            if (al.msg_type === "proposal_open_contract") {
              tempPrContractPos = prContract.indexOf(al.proposal_open_contract.contract_id);
              if (tempPrContractPos == -1) {
                return;
              }
              ;
              if (!(lastTimeMasukPOC[tempPrContractPos] == undefined || al.proposal_open_contract.current_spot_time > lastTimeMasukPOC[tempPrContractPos])) {
                return;
              }
              ;
              lastTimeMasukPOC[tempPrContractPos] = al.proposal_open_contract.current_spot_time;
              // FIX v003: Fallback robusto para display values (removidos na nova API)
              const _entryValueV = al.proposal_open_contract.entry_tick_display_value
                  ?? al.proposal_open_contract.entry_spot
                  ?? al.proposal_open_contract.entry_tick
                  ?? '—';
              if (_entryValueV !== undefined && _entryValueV !== null) {
                rowActive[tempPrContractPos].cells[2].innerText = _entryValueV;
              }
              sedangPantauContractPos = tempPrContractPos;
              // FIX v004: fallback caso is_valid_to_sell ausente na nova API
              isContractValidToSell[sedangPantauContractPos] = al.proposal_open_contract.is_valid_to_sell
                  ?? (al.proposal_open_contract.status === 'open' && !al.proposal_open_contract.is_sold && !al.proposal_open_contract.is_expired ? 1 : 0);
              // FIX v003: Garantir que profit é número
              sellProfitLoss[sedangPantauContractPos] = parseFloat(al.proposal_open_contract.profit) || 0;
              // FIX v003: Fallback robusto para exit value
              const _exitValueV = al.proposal_open_contract.exit_tick_display_value
                  ?? al.proposal_open_contract.exit_spot
                  ?? al.proposal_open_contract.exit_tick
                  ?? '—';
              
              const existingContractIndex = arrsellProfitLoss_multimarket.findIndex(item => 
                                item.cont_id === al.proposal_open_contract.contract_id
                            );
                            
                            // Verifica se o cont_id já está no array de contratos vendidos
                            const isContractSold = arr_multimarketVendido.includes(al.proposal_open_contract.contract_id);
                            
                            // FIX v003: Garantir que cont_profit é número
                            const _profitV = parseFloat(al.proposal_open_contract.profit) || 0;
                            
                            // Se o contrato já existir e não estiver vendido, substitui os dados antigos pelos novos
                            if (existingContractIndex !== -1 && al.proposal_open_contract.is_sold === 0 && !isContractSold) {
                                arrsellProfitLoss_multimarket[existingContractIndex] = {
                                    market_symbol: al.proposal_open_contract.underlying,
                                    cont_type: al.proposal_open_contract.contract_type,
                                    cont_profit: _profitV,
                                    cont_id: al.proposal_open_contract.contract_id
                                };
                            } 
                            // Se não existir e não estiver vendido, adiciona o novo contrato ao array
                            else if (al.proposal_open_contract.is_sold === 0 && !isContractSold) {
                                arrsellProfitLoss_multimarket.push({
                                    market_symbol: al.proposal_open_contract.underlying,
                                    cont_type: al.proposal_open_contract.contract_type,
                                    cont_profit: _profitV,
                                    cont_id: al.proposal_open_contract.contract_id
                                });
                            }
              if (_exitValueV != undefined && (al.proposal_open_contract.is_sold || al.proposal_open_contract.is_expired || al.proposal_open_contract.is_settleable || al.proposal_open_contract.current_spot_time > al.proposal_open_contract.expiry_time || al.proposal_open_contract.status != "open")) {
                if (Object.hasOwn(al, "subscription")) {
                  v.send(JSON.stringify({
                    forget: al.subscription.id,
                    passthrough: {
                      app_id: app_id
                    }
                  }));
                }
                v.send(JSON.stringify({
                  statement: 1,
                  limit: 1
                }));
                updateResultV(al.proposal_open_contract.contract_id, al.proposal_open_contract.status, al.proposal_open_contract.profit, al.proposal_open_contract.buy_price, al.proposal_open_contract.payout, al.proposal_open_contract.contract_type, al.proposal_open_contract.entry_tick_time, al.proposal_open_contract.entry_tick, al.proposal_open_contract.entry_tick_display_value, al.proposal_open_contract.exit_tick_time, al.proposal_open_contract.exit_tick, _exitValueV, al.proposal_open_contract.barrier, al.proposal_open_contract.underlying);
                return true;
              }
              func$1$9$8$7$SellConditions();
            } else {}
          }
        } // fecha else do proposal slave
        }
      }
    }
  }
};
const forgetAllTicks = () => {
  sedangForgetAllTicks = true;
  if (isNewApiUser) {
    if (idSubTicksHistory && idSubTicksHistory.length > 0) {
      [vData1, vData2].forEach(ws => {
        if (ws?.readyState === 1) ws.send(JSON.stringify({ forget: idSubTicksHistory }));
      });
    }
    [vData1, vData2].forEach(ws => {
      if (ws?.readyState === 1) ws.send(JSON.stringify({
        forget_all: ["ticks"],
        passthrough: { app_id, next: "historyTicks" }
      }));
    });
  } else {
    if (idSubTicksHistory && idSubTicksHistory.length > 0) {
      vEval.send(JSON.stringify({ forget: idSubTicksHistory }));
    }
    vEval.send(JSON.stringify({ forget_all: ["ticks"] }));
  }
};
const forgetTicks = an => {
  if (!an || an.length === 0) return;
  const target = isNewApiUser ? (vData1?.readyState === 1 ? vData1 : vData2) : vEval;
  if (target?.readyState === 1) {
    target.send(JSON.stringify({
      forget: an,
      passthrough: { app_id }
    }));
  }
};
const subscribeTicks = (ao, ap, aq) => {
  const target = isNewApiUser ? getDataWSTarget(aq) : null;
  const ws = (target && target.readyState === 1) ? target : vEval;
  ws.send(JSON.stringify({
    subscribe: 1,
    ticks_history: aq,
    adjust_start_time: 1,
    count: inpNOTicks.value < 1001 ? 1001 : inpNOTicks.value,
    end: "latest",
    start: 1,
    style: "ticks",
    passthrough: {
      app_id: app_id,
      status_nya: ao,
      index_nya: ap
    }
  }));
};



arrMarket_Continuous.forEach(symbol => {
  candleData[symbol] = granularityArray.reduce((acc, g) => {
    acc[g] = {
      history: [],
      current: {
        epoch: 0,
        open: 0,
        high: 0,
        low: Infinity,
        close: 0
      },
      lastUpdate: 0
    };
    return acc;
  }, {});
});

function getCandleValue(ohlcType, symbol, granularity, index) {
    try {
        const data = candleData[symbol][granularity];
        if (!data) return 0;

        const pipSize = data.current?.pip_size ?? 2;

        let rawValue;

        if (index === 0) {
            rawValue = data.current?.[ohlcType] || 0;
        } else {
            const historyIndex = index - 1;
            if (historyIndex >= data.history.length || historyIndex < 0) return 0;
            const candle = data.history[data.history.length - 1 - historyIndex];
            rawValue = candle?.[ohlcType] || 0;
        }

        const roundedValue = 
            typeof rawValue === 'number' 
                ? Number(rawValue.toFixed(pipSize)) 
                : 0;

        return roundedValue;
    } catch (error) {
        console.error('Erro em getCandleValue:', error);
        return 0;
    }
};

function processCandleData(ae) {
  try {
    const symbol = ae.echo_req.ticks_history;
    const granularity = ae.echo_req.granularity;
    const pipSize = ae.pip_size;
    if (!symbol || !granularity) {
      console.error('Symbol ou granularidade não definidos:', symbol, granularity);
      return;
    }
    
    if (!arrMarket_Continuous.includes(symbol) || !granularityArray.includes(granularity)) {
      console.error('Market/Granularidade não suportados:', symbol, granularity);
      return;
    }

    if (ae.candles) {
    
    const completeCandles = ae.candles.slice(0, -1); 
    
    candleData[symbol][granularity].history = completeCandles.map(c => ({
        epoch: c.epoch,
        open: parseFloat(c.open),
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        close: parseFloat(c.close)
    })).sort((a, b) => a.epoch - b.epoch);
    }
    
  } catch (error) {
    console.error('Erro no processamento de candles históricos:', error);
  }
};

function processOHLCData(ae) {
    try {
        const symbol = ae.ohlc.symbol;
        const granularity = ae.ohlc.granularity;
        const pipSize = ae.ohlc.pip_size;

        if (!candleData[symbol]?.[granularity]) return;

        const newCandle = {
            epoch: ae.ohlc.open_time,
            granularity: ae.ohlc.granularity,
            open: parseFloat(ae.ohlc.open),
            high: parseFloat(ae.ohlc.high),
            low: parseFloat(ae.ohlc.low),
            close: parseFloat(ae.ohlc.close),
            current_epoch: ae.ohlc.epoch,
            pip_size: pipSize
        };

        const current = candleData[symbol][granularity].current;

        if (current.epoch !== newCandle.epoch) {
            if (current.epoch !== 0) {
                candleData[symbol][granularity].history.push(current);
                if (candleData[symbol][granularity].history.length > 1000) {
                    candleData[symbol][granularity].history.shift();
                }
            }
            candleData[symbol][granularity].current = newCandle;
        } else {
            candleData[symbol][granularity].current = {
                ...newCandle,
                high: Math.max(current.high, newCandle.high),
                low: Math.min(current.low, newCandle.low),
                current_epoch: newCandle.current_epoch
            };
        }
        
        updateCandleTable(granularity);
    } catch (error) {
        console.error('Erro no processamento de OHLC:', error);
    }
};

function updateCountdowns() {
    const symbol = mainSymbol;

    granularityArray.forEach(g => {
        const marketData = candleData[symbol]?.[g];
        if (!marketData?.current) return;

        const endTime = marketData.current.epoch + marketData.current.granularity;
        const currentEpoch = marketData.current.current_epoch;
        const remaining = endTime - currentEpoch;

        if (remaining < 0) return;

        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        const countdownElement = document.getElementById(`countdown_${g}`);

        if (countdownElement) {
            countdownElement.textContent = 
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            
            countdownElement.style.color = remaining <= 10 ? '#ff0000' : '#00ff00';
        }
    });
}
setInterval(updateCountdowns, 1000);

const subscribeCandles = (symbol, granularity) => {
  const g = parseInt(granularity);
  if(isNaN(g)) return;
  if (!vEval || vEval.readyState !== 1) return; // FIX v004 Bug C: guard readyState antes de send
  
  vEval.send(JSON.stringify({
    subscribe: 1,
    ticks_history: symbol,
    adjust_start_time: 1,
    count: 1000,
    end: "latest",
    start: 1,
    style: "candles",
    granularity: g,
    passthrough: {
      app_id: app_id,
    }
  }));
};

// ===== DATA WEBSOCKETS (NOVA API) — SUBSCRIBE HELPERS =====
const subscribeCandlesList = (ws, symbols) => {
  symbols.forEach(symbol => {
    granularityArray.forEach(g => {
      if (isNaN(g)) return;
      ws.send(JSON.stringify({
        subscribe: 1,
        ticks_history: symbol,
        adjust_start_time: 1,
        count: 1000,
        end: "latest",
        start: 1,
        style: "candles",
        granularity: g,
        passthrough: { app_id }
      }));
    });
  });
};

const subscribeTicksOnDataWS = (ws, ao, ap, aq) => {
  console.log("[DataWS] subscribeTicks:", aq, "status:", ao, "index:", ap);
  ws.send(JSON.stringify({
    subscribe: 1,
    ticks_history: aq,
    adjust_start_time: 1,
    count: inpNOTicks.value < 1001 ? 1001 : inpNOTicks.value,
    end: "latest",
    start: 1,
    style: "ticks",
    passthrough: { app_id, status_nya: ao, index_nya: ap }
  }));
};

const getDataWSTarget = (symbol) => {
  return symbol && symbol.startsWith("1HZ") ? vData1 : vData2;
};

// ===== DATA WEBSOCKETS (NOVA API) — HANDLERS =====
function setupDataWebSockets() {
  vData1 = new WebSocket(PUBLIC_WS);
  vData1.addEventListener("open", openDataResponse1);
  vData1.addEventListener("message", messageDataResponse);
  vData1.addEventListener("close", closeDataResponse1);

  vData2 = new WebSocket(PUBLIC_WS);
  vData2.addEventListener("open", openDataResponse2);
  vData2.addEventListener("message", messageDataResponse);
  vData2.addEventListener("close", closeDataResponse2);
}

function openDataResponse1() {
  wsData1Opened = true;
  getSymbols();
  subscribeCandlesList(vData1, ["1HZ10V", "1HZ25V", "1HZ50V", "1HZ75V", "1HZ100V"]);
  ["1HZ10V", "1HZ25V", "1HZ50V", "1HZ75V", "1HZ100V"].forEach((sym, idx) => {
    setTimeout(() => subscribeTicksOnDataWS(vData1, "continuousindices", idx + 1, sym), idx * 10);
  });
  cekWSOpened();
  if (!pingInterval) startPingKeepalive();
}

function openDataResponse2() {
  wsData2Opened = true;
  subscribeCandlesList(vData2, ["R_10", "R_25", "R_50", "R_75", "R_100"]);
  ["R_10", "R_25", "R_50", "R_75", "R_100"].forEach((sym, idx) => {
    setTimeout(() => subscribeTicksOnDataWS(vData2, "continuousindices", idx + 6, sym), idx * 10);
  });
  // Fix Bug E: race condition recovery — subscribe mainSymbol if vData2 opened after forgetAllTicks()
  // forgetAllTicks() silently skips vData2 when it's not yet open (readyState guard), so R_ main
  // symbol never gets subscribed. We detect this here and subscribe directly.
  if (mainSymbol && mainSymbol.startsWith("R_")) {
    const mainIdx = arrMarket_Continuous.indexOf(mainSymbol) + 1;
    setTimeout(() => subscribeTicksOnDataWS(vData2, "main", mainIdx, mainSymbol), 60);
  }
  cekWSOpened();
  if (!pingInterval) startPingKeepalive();
}

function closeDataResponse1() {
  wsData1Opened = false;
  setTimeout(() => {
    if (isNewApiUser) {
      vData1 = new WebSocket(PUBLIC_WS);
      vData1.addEventListener("open", openDataResponse1);
      vData1.addEventListener("message", messageDataResponse);
      vData1.addEventListener("close", closeDataResponse1);
    }
  }, 3000);
}

function closeDataResponse2() {
  wsData2Opened = false;
  setTimeout(() => {
    if (isNewApiUser) {
      vData2 = new WebSocket(PUBLIC_WS);
      vData2.addEventListener("open", openDataResponse2);
      vData2.addEventListener("message", messageDataResponse);
      vData2.addEventListener("close", closeDataResponse2);
    }
  }, 3000);
}

function startPingKeepalive() {
  pingInterval = setInterval(() => {
    if (vData1?.readyState === 1) vData1.send(JSON.stringify({ ping: 1 }));
    if (vData2?.readyState === 1) vData2.send(JSON.stringify({ ping: 1 }));
  }, 30000);
}

const messageDataResponse = ad => {
  const ae = JSON.parse(ad.data);
  if (ae.error !== undefined) {
    if (["forget", "forget_all", "ticks_history"].includes(ae.msg_type)) {}
    else { console.log("DataWS msg_type:", ae.msg_type, "Error:", ae.error.message); }
  } else {
    const PT = (msg) => msg.echo_req?.passthrough ?? msg.passthrough;
    if (ae.msg_type === "active_symbols") {
      arrangeSymbols(ae);
    } else if (ae.msg_type === "forget") {
    } else if (ae.msg_type === "forget_all") {
      console.log("[DataWS] forget_all received, target:", ad.target === vData1 ? "vData1" : "vData2", "mainSymbol:", mainSymbol);
      const targetWS = ad.target === vData1 ? vData1 : vData2;
      const isGroup1HZ = targetWS === vData1;
      const symbols = isGroup1HZ
        ? ["1HZ10V", "1HZ25V", "1HZ50V", "1HZ75V", "1HZ100V"]
        : ["R_10", "R_25", "R_50", "R_75", "R_100"];
      const baseIndex = isGroup1HZ ? 1 : 6;
      symbols.forEach((sym, idx) => {
        subscribeTicksOnDataWS(targetWS, "continuousindices", baseIndex + idx, sym);
      });
      if ((isGroup1HZ && mainSymbol?.startsWith("1HZ")) || (!isGroup1HZ && mainSymbol?.startsWith("R_"))) {
        const mainIdx = arrMarket_Continuous.indexOf(mainSymbol) + 1;
        subscribeTicksOnDataWS(targetWS, "main", mainIdx, mainSymbol);
      }
    } else if (ae.msg_type === "history") {
      console.log("[DataWS] history received, echo_req:", !!ae.echo_req, "passthrough top-level:", !!ae.passthrough, "PT status:", PT(ae)?.status_nya, "PT index:", PT(ae)?.index_nya, "symbol:", ae.echo_req?.ticks_history || ad.target);
      if (PT(ae)?.status_nya == "main") {
        idSubTicksHistory = ae.subscription.id;
        lastTimeGetTick = ae.history.times[ae.history.times.length - 1];
        tickArrayUtama.length = 0; tickArrayUtamaText.length = 0;
        tickArrayUtama = ae.history.prices;
        for (i = 0; i < ae.history.prices.length; i++) {
          tickArrayUtamaText[i] = ae.history.prices[i].toFixed(ae.pip_size);
        }
        digitArrayUtama.length = 0;
        for (i = 0; i < ae.history.prices.length; i++) {
          digitArrayUtama[i] = parseInt(ae.history.prices[i].toFixed(ae.pip_size).slice(-1));
        }
        showUpAllAboutTick(tickArrayUtama, digitArrayUtama, ae.pip_size, "history");
        if (PT(ae).index_nya > 0) {
          let af = PT(ae).index_nya;
          idSubTicksHistory_continuous[af] = idSubTicksHistory;
          lastTimeGetTick_continuous[af] = lastTimeGetTick;
          tickArrayUtama_continuous[af] = tickArrayUtama;
          digitArrayUtama_continuous[af] = digitArrayUtama;
          showUpAboutMultiMarket_Continuous(af, tickArrayUtama_continuous[af], digitArrayUtama_continuous[af], ae.pip_size, "history");
        }
      } else {
        let ag = PT(ae).index_nya;
        idSubTicksHistory_continuous[ag] = ae.subscription.id;
        lastTimeGetTick_continuous[ag] = ae.history.times[ae.history.times.length - 1];
        tickArrayUtama_continuous[ag] = []; tickArrayUtamaText_continuous[ag] = [];
        tickArrayUtama_continuous[ag] = ae.history.prices;
        for (i = 0; i < ae.history.prices.length; i++) {
          tickArrayUtamaText_continuous[ag][i] = ae.history.prices[i].toFixed(ae.pip_size);
        }
        digitArrayUtama_continuous[ag] = [];
        for (i = 0; i < ae.history.prices.length; i++) {
          digitArrayUtama_continuous[ag][i] = parseInt(ae.history.prices[i].toFixed(ae.pip_size).slice(-1));
        }
        showUpAboutMultiMarket_Continuous(ag, tickArrayUtama_continuous[ag], digitArrayUtama_continuous[ag], ae.pip_size, "history");
      }
      sedangForgetAllTicks = false;
    } else if (ae.msg_type === "candles") {
      processCandleData(ae);
    } else if (ae.msg_type === "ohlc") {
      processOHLCData(ae);
    } else if (ae.msg_type === "tick") {
      console.log("[DataWS] tick received, PT status:", PT(ae)?.status_nya, "PT index:", PT(ae)?.index_nya, "quote:", ae.tick?.quote);
      if (PT(ae)?.status_nya == "main") {
        if (lastTimeGetTick < ae.tick.epoch) {
          lastTimeGetTick = ae.tick.epoch;
          tickArrayUtama.shift(); tickArrayUtamaText.shift();
          tickArrayUtama.push(ae.tick.quote);
          tickArrayUtamaText.push(ae.tick.quote.toFixed(ae.tick.pip_size));
          digitArrayUtama.shift();
          digitArrayUtama.push(parseInt(ae.tick.quote.toFixed(ae.tick.pip_size).slice(-1)));
          showUpAllAboutTick(tickArrayUtama, digitArrayUtama, ae.tick.pip_size, "tick");
          if (PT(ae).index_nya > 0) {
            let ah = PT(ae).index_nya;
            lastTimeGetTick_continuous[ah] = lastTimeGetTick;
            tickArrayUtama_continuous[ah] = tickArrayUtama;
            digitArrayUtama_continuous[ah] = digitArrayUtama;
            showUpAboutMultiMarket_Continuous(ah, tickArrayUtama_continuous[ah], digitArrayUtama_continuous[ah], ae.tick.pip_size, "tick");
          }
        }
      } else {
        let ai = PT(ae).index_nya;
        if (lastTimeGetTick_continuous[ai] < ae.tick.epoch) {
          lastTimeGetTick_continuous[ai] = ae.tick.epoch;
          tickArrayUtama_continuous[ai].shift(); tickArrayUtamaText_continuous[ai].shift();
          tickArrayUtama_continuous[ai].push(ae.tick.quote);
          tickArrayUtamaText_continuous[ai].push(ae.tick.quote.toFixed(ae.tick.pip_size));
          digitArrayUtama_continuous[ai].shift();
          digitArrayUtama_continuous[ai].push(parseInt(ae.tick.quote.toFixed(ae.tick.pip_size).slice(-1)));
          showUpAboutMultiMarket_Continuous(ai, tickArrayUtama_continuous[ai], digitArrayUtama_continuous[ai], ae.tick.pip_size, "tick");
        }
      }
    }
  }
};

const createChartLast10Dig_Digit = () => {
  const au = document.getElementById("chart_last10dig_digit").getContext("2d");
  const av = ["10th", "9th", "8th", "7th", "6th", "5th", "4th", "3rd", "2nd", "1st"];
  mainChartLast10Dig_Digit = new Chart(au, {
    type: "line",
    data: {
      labels: av,
      datasets: [{
        label: "Digit + Digit Move",
        fill: false,
        backgroundColor: "#2e2e2e",
        borderColor: "#fff",
        borderWidth: 1,
        data: -999,
        pointStyle: true,
        pointRadius: 5,
        pointHoverRadius: 8,
        pointBorderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: "#fff"
          }
        }
      }
    },
    plugins: [ChartDataLabels],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: "Digit + Digit Move",
          color: "#fff"
        },
        legend: {
          display: false,
          labels: {
            color: "#fff"
          }
        },
        datalabels: {
          display: true,
          color: "#2e2e2e",
          anchor: "end",
          align: "end",
          offset: -2
        }
      },
      scales: {
        x: {
          ticks: {
            color: "#fff"
          }
        },
        y: {
          ticks: {
            color: "#fff"
          },
          grid: {
            color: function (aw) {
              if (aw.tick.value > 0) {
                return "#2e2e2e";
              } else {
                if (aw.tick.value < 0) {
                  return "#2e2e2e";
                }
              }
              return "#fff";
            }
          }
        }
      }
    }
  });
};
createChartLast10Dig_Digit();
const createChartLast10Dig_Change = () => {
  const ax = document.getElementById("chart_last10dig_change").getContext("2d");
  const ay = ["10th", "9th", "8th", "7th", "6th", "5th", "4th", "3rd", "2nd", "1st"];
  mainChartLast10Dig_Change = new Chart(ax, {
    type: "line",
    data: {
      labels: ay,
      datasets: [{
        label: "Digit Change",
        fill: false,
        backgroundColor: "#2e2e2e",
        borderColor: "#fff",
        borderWidth: 1,
        data: -999,
        pointStyle: true,
        pointRadius: 5,
        pointHoverRadius: 8,
        pointBorderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: "#fff"
          }
        }
      }
    },
    plugins: [ChartDataLabels],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: "Digit Change",
          color: "#fff"
        },
        legend: {
          display: false,
          labels: {
            color: "#fff"
          }
        },
        datalabels: {
          display: true,
          color: "#2e2e2e",
          anchor: "end",
          align: "end",
          offset: -2
        }
      },
      scales: {
        x: {
          ticks: {
            color: "#fff"
          }
        },
        y: {
          ticks: {
            color: "#fff"
          },
          grid: {
            color: function (az) {
              if (az.tick.value > 0) {
                return "#2e2e2e";
              } else {
                if (az.tick.value < 0) {
                  return "#2e2e2e";
                }
              }
              return "#fff";
            }
          }
        }
      }
    }
  });
};
createChartLast10Dig_Change();
const createChart20Cater = () => {
  const ba = document.getElementById("chart20cater").getContext("2d");
  const bb = ["20th", "19th", "18th", "17th", "16th", "15th", "14th", "13th", "12th", "11th", "10th", "9th", "8th", "7th", "6th", "5th", "4th", "3rd", "2nd", "1st"];
  mainChart20Cater = new Chart(ba, {
    type: "line",
    data: {
      labels: bb,
      datasets: [{
        fill: false,
        lineTension: 0,
        backgroundColor: ["#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e"],
        borderColor: "#fff",
        borderWidth: 1,
        data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        pointRadius: 5,
        pointHoverRadius: 8,
        pointBorderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        }
      }
    },
    plugins: [ChartDataLabels],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        datalabels: {
          color: ["#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e"],
          anchor: "end",
          align: "end",
          offset: -2
        }
      },
      scales: {
        x: {
          ticks: {
            color: "#fff"
          }
        },
        y: {
          ticks: {
            color: "#fff"
          },
          min: -10,
          max: 10,
          grid: {
            color: function (bc) {
              if (bc.tick.value > 0) {
                return "#2e2e2e";
              } else {
                if (bc.tick.value < 0) {
                  return "#2e2e2e";
                }
              }
              return "#fff";
            }
          }
        }
      }
    }
  });
};
createChart20Cater();
const createChartLast10Tick_Tick = () => {
  const bd = document.getElementById("chart_last10tick_tick").getContext("2d");
  const bf = ["10th", "9th", "8th", "7th", "6th", "5th", "4th", "3rd", "2nd", "1st"];
  mainChartLast10Tick_Tick = new Chart(bd, {
    type: "line",
    data: {
      labels: bf,
      datasets: [{
        label: "Tick + Move",
        fill: false,
        backgroundColor: "#2e2e2e",
        borderColor: "#fff",
        borderWidth: 1,
        data: -999,
        pointStyle: true,
        pointRadius: 5,
        pointHoverRadius: 8,
        pointBorderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: "#fff"
          }
        }
      }
    },
    plugins: [ChartDataLabels],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: "Tick + Move",
          color: "#fff"
        },
        legend: {
          display: false,
          labels: {
            color: "#fff"
          }
        },
        datalabels: {
          display: true,
          color: "#2e2e2e",
          anchor: "end",
          align: "end",
          offset: -2
        }
      },
      scales: {
        x: {
          ticks: {
            color: "#fff"
          }
        },
        y: {
          ticks: {
            color: "#fff"
          },
          grid: {
            color: function (bg) {
              if (bg.tick.value > 0) {
                return "#2e2e2e";
              } else {
                if (bg.tick.value < 0) {
                  return "#2e2e2e";
                }
              }
              return "#fff";
            }
          }
        }
      }
    }
  });
};
createChartLast10Tick_Tick();
const createChartLast10Tick_Change = () => {
  const bh = document.getElementById("chart_last10tick_change").getContext("2d");
  const bi = ["10th", "9th", "8th", "7th", "6th", "5th", "4th", "3rd", "2nd", "1st"];
  mainChartLast10Tick_Change = new Chart(bh, {
    type: "line",
    data: {
      labels: bi,
      datasets: [{
        label: "Tick Change",
        fill: false,
        backgroundColor: "#2e2e2e",
        borderColor: "#fff",
        borderWidth: 1,
        data: -999,
        pointStyle: true,
        pointRadius: 5,
        pointHoverRadius: 8,
        pointBorderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: "#fff"
          }
        }
      }
    },
    plugins: [ChartDataLabels],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: "Tick Change",
          color: "#fff"
        },
        legend: {
          display: false,
          labels: {
            color: "#fff"
          }
        },
        datalabels: {
          display: true,
          color: "#2e2e2e",
          anchor: "end",
          align: "end",
          offset: -2
        }
      },
      scales: {
        x: {
          ticks: {
            color: "#fff"
          }
        },
        y: {
          ticks: {
            color: "#fff"
          },
          grid: {
            color: function (bj) {
              if (bj.tick.value > 0) {
                return "#2e2e2e";
              } else {
                if (bj.tick.value < 0) {
                  return "#2e2e2e";
                }
              }
              return "#fff";
            }
          }
        }
      }
    }
  });
};
createChartLast10Tick_Change();
const createChart20TickWorm = () => {
  const bk = document.getElementById("chart20tickworm").getContext("2d");
  const bl = ["20th", "19th", "18th", "17th", "16th", "15th", "14th", "13th", "12th", "11th", "10th", "9th", "8th", "7th", "6th", "5th", "4th", "3rd", "2nd", "1st"];
  mainChart20TickWorm = new Chart(bk, {
    type: "line",
    data: {
      labels: bl,
      datasets: [{
        fill: false,
        lineTension: 0,
        backgroundColor: ["#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e"],
        borderColor: "#fff",
        borderWidth: 1,
        data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        pointStyle: [false],
        pointRadius: 10,
        pointHoverRadius: 15,
        pointBorderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        }
      }
    },
    plugins: [ChartDataLabels],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        datalabels: {
          color: ["#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e"],
          anchor: "end",
          align: "end",
          offset: -2
        }
      },
      scales: {
        x: {
          ticks: {
            color: "#fff"
          }
        },
        y: {
          ticks: {
            color: "#fff"
          },
          grid: {
            color: function (bm) {
              if (bm.tick.value > 0) {
                return "#2e2e2e";
              } else {
                if (bm.tick.value < 0) {
                  return "#2e2e2e";
                }
              }
              return "#fff";
            }
          }
        }
      }
    }
  });
};
createChart20TickWorm();
const createChartTickTrisma = () => {
  const bn = document.getElementById("chartticktrisma").getContext("2d");
  const bo = ["101st", "100th", "99th", "98th", "97th", "96th", "95th", "94th", "93th", "92th", "91th", "90th", "89th", "88th", "87th", "86th", "85th", "84th", "83th", "82th", "81th", "80th", "79th", "78th", "77th", "76th", "75th", "74th", "73th", "72th", "71th", "70th", "69th", "68th", "67th", "66th", "65th", "64th", "63th", "62th", "61th", "60th", "59th", "58th", "57th", "56th", "55th", "54th", "53th", "52th", "51th", "50th", "49th", "48th", "47th", "46th", "45th", "44th", "43th", "42th", "41th", "40th", "39th", "38th", "37th", "36th", "35th", "34th", "33th", "32th", "31th", "30th", "29th", "28th", "27th", "26th", "25th", "24th", "23rd", "22nd", "21st", "20th", "19th", "18th", "17th", "16th", "15th", "14th", "13th", "12th", "11th", "10th", "9th", "8th", "7th", "6th", "5th", "4th", "3rd", "2nd", "1st"];
  mainChartTickTrisma = new Chart(bn, {
    type: "line",
    data: {
      labels: bo,
      datasets: [{
        label: "Price",
        fill: false,
        backgroundColor: "#2e2e2e",
        borderColor: "#fff",
        borderWidth: 1,
        data: -999,
        pointStyle: false,
        pointRadius: 5,
        pointHoverRadius: 8
      }, {
        label: "SMA#1",
        fill: false,
        backgroundColor: "#2e2e2e",
        borderColor: "#f00",
        borderWidth: 1,
        data: -999,
        pointStyle: false,
        pointRadius: 5,
        pointHoverRadius: 8,
        cubicInterpolationMode: "monotone",
        tension: 0.4
      }, {
        label: "SMA#2",
        fill: false,
        backgroundColor: "#2e2e2e",
        borderColor: "#0f0",
        borderWidth: 1,
        data: -999,
        pointStyle: false,
        pointRadius: 5,
        pointHoverRadius: 8,
        cubicInterpolationMode: "monotone",
        tension: 0.4
      }, {
        label: "SMA#3",
        fill: false,
        backgroundColor: "#2e2e2e",
        borderColor: "#00f",
        borderWidth: 1,
        data: -999,
        pointStyle: false,
        pointRadius: 5,
        pointHoverRadius: 8,
        cubicInterpolationMode: "monotone",
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: "#fff"
          }
        }
      }
    },
    plugins: [ChartDataLabels],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: "#fff"
          }
        },
        datalabels: {
          display: false,
          color: ["#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e", "#2e2e2e"],
          anchor: "end",
          align: "end",
          offset: -2
        }
      },
      scales: {
        x: {
          ticks: {
            color: "#fff"
          }
        },
        y: {
          ticks: {
            color: "#fff"
          },
          grid: {
            color: function (bp) {
              if (bp.tick.value > 0) {
                return "#2e2e2e";
              } else {
                if (bp.tick.value < 0) {
                  return "#2e2e2e";
                }
              }
              return "#fff";
            }
          }
        }
      }
    }
  });
};
createChartTickTrisma();
function addDataChartLast10Dig_Digit(bq, br, bt) {
  const bu = bq.data;
  if (bu.datasets.length > 0) {
    for (let bv = 0; bv < bu.datasets.length; ++bv) {
      bu.datasets[bv].data = br;
      bu.datasets[bv].backgroundColor = bt;
    }
    bq.options.plugins.datalabels.color = bt;
    bq.update("none");
  }
}
function addDataChartLast10Dig_Change(bw, bx, by) {
  const bz = bw.data;
  if (bz.datasets.length > 0) {
    for (let ca = 0; ca < bz.datasets.length; ++ca) {
      bz.datasets[ca].data = bx;
      bz.datasets[ca].backgroundColor = by;
    }
    bw.options.plugins.datalabels.color = by;
    bw.update("none");
  }
}
function addDataChart20Cater(cb, cc, cd) {
  const ce = cb.data;
  if (ce.datasets.length > 0) {
    for (let cf = 0; cf < ce.datasets.length; ++cf) {
      ce.datasets[cf].data = cc;
      ce.datasets[cf].backgroundColor = cd;
    }
    cb.options.plugins.datalabels.color = cd;
    cb.update("none");
  }
}
function addDataChartLast10Tick_Tick(cg, ch, ci) {
  const cj = cg.data;
  if (cj.datasets.length > 0) {
    for (let cl = 0; cl < cj.datasets.length; ++cl) {
      cj.datasets[cl].data = ch;
      cj.datasets[cl].backgroundColor = ci;
    }
    cg.options.plugins.datalabels.color = ci;
    cg.update("none");
  }
}
function addDataChartLast10Tick_Change(cm, cn, co) {
  const cp = cm.data;
  if (cp.datasets.length > 0) {
    for (let cq = 0; cq < cp.datasets.length; ++cq) {
      cp.datasets[cq].data = cn;
      cp.datasets[cq].backgroundColor = co;
    }
    cm.options.plugins.datalabels.color = co;
    cm.update("none");
  }
}
function addDataChart20TickWorm(cr, cs, ct, cu) {
  const cv = cr.data;
  if (cv.datasets.length > 0) {
    for (let cw = 0; cw < cv.datasets.length; ++cw) {
      cv.datasets[cw].data = cs;
      cv.datasets[cw].backgroundColor = ct;
      cv.datasets[cw].pointStyle = cu;
    }
    cr.options.plugins.datalabels.color = ct;
    cr.update("none");
  }
}
function addDataChartticktrisma(cx, cy) {
  const cz = cx.data;
  if (cz.datasets.length > 0) {
    for (let da = 0; da < cz.datasets.length; ++da) {
      cz.datasets[da].data = cy[da];
    }
    cx.update("none");
  }
}

function sendToTelegram(p5, p6, p7) {
  const v6 = "https://api.telegram.org/bot" + p5 + "/sendMessage?chat_id=" + p6 + "&text=" + p7;
  const v7 = new XMLHttpRequest();
  v7.open("GET", v6);
  v7.send();
}

// FUNÇÕES DOS INDICADORES

function calculateMovingAverage(db, dc) {
  var dd = [];
  if (db.length < dc) {
    return dd;
  }
  var de = 0;
  for (var df = 0; df < dc; ++df) {
    de += db[df];
  }
  dd.push(de / dc);
  var dg = db.length - dc - 1;
  for (var df = 0; df < dg; ++df) {
    de = de - db[df];
    de = de + db[df + dc];
    dd.push(de / dc);
  }
  return dd;
}

function calculateMovingAverageCandles(inputList, period, outputType) {
  const isCandleData = inputList.length > 0 && typeof inputList[0] === 'object';
  const prices = isCandleData ? 
    inputList.map(candle => candle.close) : 
    inputList;

  const sma = [];
  for (let i = period - 1; i < prices.length; i++) {
    const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    sma.push(sum / period);
  }

  if (outputType === 'last') {
    return sma[sma.length - 1];
  }
  return sma;
}

function calculateRSI(inputList, period) {
  const isCandleData = inputList.length > 0 && typeof inputList[0] === 'object';
  const prices = isCandleData ? 
    inputList.map(candle => candle.close) : 
    inputList;

  if (prices.length < period + 1) return null;

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const delta = prices[i] - prices[i-1];
    avgGain += Math.max(delta, 0);
    avgLoss += Math.abs(Math.min(delta, 0));
  }

  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < prices.length; i++) {
    const delta = prices[i] - prices[i-1];
    const gain = Math.max(delta, 0);
    const loss = Math.abs(Math.min(delta, 0));

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100.00;
  
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  
  return Math.round(rsi * 100) / 100;
}

function calculateRSIArray(inputData, period, outputType = 'last') {
  const isCandleData = inputData.length > 0 && typeof inputData[0] === 'object';
  const prices = isCandleData ? 
    inputData.map(candle => candle.close) : 
    inputData;

  if (prices.length < period + 1) {
    return outputType === 'full' ? [] : null;
  }

  const rsiValues = [];
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    avgGain += Math.max(0, change);
    avgLoss += Math.max(0, -change);
  }

  avgGain /= period;
  avgLoss /= period;

  const firstRS = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  rsiValues.push(Number(firstRS.toFixed(2)));

  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = Math.max(0, change);
    const loss = Math.max(0, -change);

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const currentRSI = 100 - (100 / (1 + rs));
    rsiValues.push(Number(currentRSI.toFixed(2)));
  }

  return outputType === 'last' ? rsiValues[rsiValues.length - 1] : rsiValues;
}

function calculateBollingerBand(inputList, period, multiplier, maType, bandType, outputType) {
  const isCandleData = inputList.length > 0 && typeof inputList[0] === 'object';
  const decimalPlaces = 4;
  const multiplierFactor = 10 ** decimalPlaces;

  const prices = isCandleData ? 
    inputList.map(candle => candle.close) : 
    inputList;

  if (prices.length < period) return outputType === 'full' ? [] : null;

  const bands = [];
  const maValues = [];

  if (maType === 'sma') {
    for (let i = period - 1; i < prices.length; i++) {
      const slice = prices.slice(i - period + 1, i + 1);
      maValues.push(slice.reduce((a, b) => a + b, 0) / period);
    }
  } else {
    const k = 2 / (period + 1);
    for (let i = 0; i < period - 1; i++) {
      maValues.push(NaN);
    }
    
    const initialSMA = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    maValues.push(initialSMA);
    
    let ema = initialSMA;
    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
      maValues.push(ema);
    }
  }

  for (let i = 0; i < maValues.length; i++) {
    if (isNaN(maValues[i])) {
      bands.push(NaN);
      continue;
    }

    const startIdx = maType === 'sma' ? i : i - period + 1;
    const endIdx = i + 1;
    
    if (startIdx < 0 || endIdx > prices.length) {
      bands.push(NaN);
      continue;
    }

    const slice = prices.slice(startIdx, endIdx);
    
    const stdDev = Math.sqrt(
      slice.map(price => Math.pow(price - maValues[i], 2))
           .reduce((a, b) => a + b, 0) / slice.length
    );

    const value = {
      upper: maValues[i] + (stdDev * multiplier),
      middle: maValues[i],
      lower: maValues[i] - (stdDev * multiplier)
    }[bandType];

    bands.push(Math.round(value * multiplierFactor) / multiplierFactor);
  }

  const validBands = outputType === 'full' && maType === 'ema' 
    ? bands.slice(period - 1) 
    : bands;

  return outputType === 'full' ? validBands : validBands[validBands.length - 1];
}

function calculateCCI_ticks(prices, period) {
  let cci = [];
  let typicalPrice = [];
  
  for (let i = 0; i < prices.length; i++) {
    typicalPrice.push(prices[i]);
    if (i >= period - 1) {
      let mean = typicalPrice.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
      let deviation = typicalPrice.slice(i - period + 1, i + 1).reduce((a, b) => a + Math.abs(b - mean), 0) / period;
      cci.push((typicalPrice[i] - mean) / (0.015 * deviation));
    }
  }
  return cci;
}

function calculateCCICandles(candles, period, priceType = 'typical', outputType = 'full') {
  if(candles.length < period) return outputType === 'full' ? [] : null;
  
  const priceMap = {
    'typical': c => (c.high + c.low + c.close) / 3,
    'close': c => c.close,
    'hl_avg': c => (c.high + c.low) / 2,
    'open': c => c.open
  };
  
  const selectedPrices = candles.map(priceMap[priceType]);
  const cci = [];
  
  for(let i = period - 1; i < selectedPrices.length; i++) {
    const window = selectedPrices.slice(i - period + 1, i + 1);
    const mean = window.reduce((sum, price) => sum + price, 0) / period;
    
    const meanDeviation = window
      .map(price => Math.abs(price - mean))
      .reduce((sum, dev) => sum + dev, 0) / period;

    const currentValue = (selectedPrices[i] - mean) / (0.015 * meanDeviation);
    cci.push(Number(currentValue.toFixed(2)));
  }
  
  return outputType === 'full' ? cci : cci[cci.length - 1];
}

function calculateADX_ticks(ticks, period, type = 'adx', outputType = 'full') {
    let adx = [];
    let plusDM = [];
    let minusDM = [];
    let tr = [];
    let dxValues = [];
    let diMinusValues = [];
    let diPlusValues = [];

    if (ticks.length < period * 2) {
        console.error("Número insuficiente de ticks para calcular o ADX.");
        return [];
    }

    for (let i = 1; i < ticks.length; i++) {
        let trueRange = Math.abs(ticks[i] - ticks[i - 1]);
        tr.push(trueRange);

        let priceDiff = ticks[i] - ticks[i - 1];
        let plusDMValue = (priceDiff > 0) ? priceDiff : 0;
        let minusDMValue = (priceDiff < 0) ? -priceDiff : 0;
        plusDM.push(plusDMValue);
        minusDM.push(minusDMValue);
    }

    for (let i = period; i < ticks.length; i++) {
        let avgTR = tr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
        let avgPlusDM = plusDM.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
        let avgMinusDM = minusDM.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;

        let diPlusValue = (avgTR !== 0) ? (avgPlusDM / avgTR) * 100 : 0;
        let diMinusValue = (avgTR !== 0) ? (avgMinusDM / avgTR) * 100 : 0;
        
        diMinusValues.push(diMinusValue);
        diPlusValues.push(diPlusValue);

        let dx = (diPlusValue + diMinusValue !== 0) ? (Math.abs(diPlusValue - diMinusValue) / (diPlusValue + diMinusValue)) * 100 : 0;
        dxValues.push(dx);

        if (i >= period * 2 - 1) {
            let sumDX = 0;
            for (let j = 0; j < period; j++) {
                sumDX += dxValues[dxValues.length - 1 - j];
            }
            let avgDX = sumDX / period;
            adx.push(avgDX);
        }
    }

    while (adx.length < ticks.length - period * 2 + 1) {
        adx.unshift(null);
    }

    let result;
    if (type === 'plusdi') {
        result = diPlusValues;
    } else if (type === 'minusdi') {
        result = diMinusValues;
    } else {
        result = adx;
    }
    if (outputType === 'last') {
        result = result.length > 0 ? result[result.length - 1] : null;
    }
    return result;
    
}

function calculateADXCandles(candles, adxPeriod = 14, diLength = 14, type = 'adx', outputType = 'full') {
  if (candles.length < (adxPeriod + diLength) * 2) {
    console.error("Número insuficiente de candles para calcular o ADX.");
    return outputType === 'full' ? [] : null;
  }

  const tr = [];
  const plusDM = [];
  const minusDM = [];
  const dxValues = [];
  const adx = [];
  const diPlusValues = [];
  const diMinusValues = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    const trVal = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );
    tr.push(trVal);

    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  let smoothedTR = tr.slice(0, diLength).reduce((a, b) => a + b, 0);
  let smoothedPlusDM = plusDM.slice(0, diLength).reduce((a, b) => a + b, 0);
  let smoothedMinusDM = minusDM.slice(0, diLength).reduce((a, b) => a + b, 0);

  for (let i = diLength; i < tr.length; i++) {
    smoothedTR = smoothedTR - (smoothedTR / diLength) + tr[i];
    smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM / diLength) + plusDM[i];
    smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM / diLength) + minusDM[i];

    const diPlus = (smoothedTR !== 0) ? (smoothedPlusDM / smoothedTR) * 100 : 0;
    const diMinus = (smoothedTR !== 0) ? (smoothedMinusDM / smoothedTR) * 100 : 0;
    
    diPlusValues.push(diPlus);
    diMinusValues.push(diMinus);

    const dx = (diPlus + diMinus !== 0) ?
      (Math.abs(diPlus - diMinus) / (diPlus + diMinus)) * 100 : 0;

    dxValues.push(dx);
  }

  let firstADX = dxValues.slice(0, adxPeriod).reduce((a, b) => a + b, 0) / adxPeriod;
  adx.push(Number(firstADX.toFixed(2)));

  for (let i = adxPeriod; i < dxValues.length; i++) {
    const currentADX = ((adx[i - adxPeriod] * (adxPeriod - 1)) + dxValues[i]) / adxPeriod;
    adx.push(Number(currentADX.toFixed(2)));
  }

  let result;
  if (type === 'plusdi') {
    result = diPlusValues;
  } else if (type === 'minusdi') {
    result = diMinusValues;
  } else {
    result = adx;
  }

  if (outputType === 'last') {
    result = result.length > 0 ? result[result.length - 1] : null;
  }

  return result;
}


function calculateTrueRange(candles, atrPeriod, outputType) {
  const tr = [];
  
  if (candles.length < 2) {
    return tr;
  }

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    const highLow = current.high - current.low;
    const highClose = Math.abs(current.high - previous.close);
    const lowClose = Math.abs(current.low - previous.close);

    const trueRange = Math.max(highLow, highClose, lowClose);
    tr.push(trueRange);
  }

  const atr = [];
  let rma = tr[0];

  for (let i = 0; i < tr.length; i++) {
    if (i < atrPeriod - 1) {
      continue;
    }
    
    if (i === atrPeriod - 1) {
      rma = tr.slice(0, atrPeriod).reduce((a, b) => a + b, 0) / atrPeriod;
    } else {
      rma = (rma * (atrPeriod - 1) + tr[i]) / atrPeriod;
    }
    
    atr.push(Number(rma.toFixed(2)));
  }

  if (outputType === 'last') {
    return atr.length > 0 ? atr[atr.length - 1] : null;
  }
  
  return atr;
}

function calculateTrueRangeTicks(ticks, atrPeriod, outputType) {
  const tr = [];
  
  if (ticks.length < 2) {
    return outputType === 'last' ? null : [];
  }

  for (let i = 1; i < ticks.length; i++) {
    const trueRange = Math.abs(ticks[i] - ticks[i - 1]);
    tr.push(trueRange);
  }

  const atr = [];
  let rma = tr[0];

  for (let i = 0; i < tr.length; i++) {
    if (i < atrPeriod - 1) continue;

    if (i === atrPeriod - 1) {
      rma = tr.slice(0, atrPeriod).reduce((a, b) => a + b, 0) / atrPeriod;
    } else {
      rma = (rma * (atrPeriod - 1) + tr[i]) / atrPeriod;
    }
    
    atr.push(rma);
  }

  return outputType === 'last' ? (atr[atr.length - 1] || null) : atr;
}

function calculateStochasticRSI(candles, rsiPeriod, stochPeriod, kPeriod, dPeriod) {
    const rsiValues = calculateRSI_SMMA(candles, rsiPeriod);
    
    const stochasticRSI = [];
    for (let i = stochPeriod - 1; i < rsiValues.length; i++) {
        const window = rsiValues.slice(i - stochPeriod + 1, i + 1);
        const min = Math.min(...window);
        const max = Math.max(...window);
        const current = rsiValues[i];
        const stoch = (current - min) / (max - min) * 100;
        stochasticRSI.push(Number(stoch.toFixed(2)));
    }

    const kValues = [];
    for (let i = kPeriod - 1; i < stochasticRSI.length; i++) {
        const window = stochasticRSI.slice(i - kPeriod + 1, i + 1);
        const k = window.reduce((a, b) => a + b, 0) / kPeriod;
        kValues.push(Number(k.toFixed(2)));
    }

    const dValues = [];
    for (let i = dPeriod - 1; i < kValues.length; i++) {
        const window = kValues.slice(i - dPeriod + 1, i + 1);
        const d = window.reduce((a, b) => a + b, 0) / dPeriod;
        dValues.push(Number(d.toFixed(2)));
    }

    return { stochasticRSI, kValues, dValues };
}
function calculateRSI_SMMA(candles, period) {
    let avgGain = 0;
    let avgLoss = 0;
    const rsi = [];

    for (let i = 1; i <= period; i++) {
        const change = candles[i].close - candles[i - 1].close;
        if (change > 0) {
            avgGain += change;
        } else {
            avgLoss += Math.abs(change);
        }
    }
    avgGain /= period;
    avgLoss /= period;
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    rsi.push(Number((100 - (100 / (1 + rs))).toFixed(2)));

    for (let i = period + 1; i < candles.length; i++) {
        const change = candles[i].close - candles[i - 1].close;
        let gain = 0;
        let loss = 0;

        if (change > 0) {
            gain = change;
        } else {
            loss = Math.abs(change);
        }

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;

        const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
        rsi.push(Number((100 - (100 / (1 + rs))).toFixed(2)));
    }

    return rsi;
}

function calculateATRTrailingStop(candles, atrPeriod, hhvPeriod, multiplier, outputType = 'full') {
    if (candles.length < Math.max(atrPeriod, hhvPeriod)) {
        return outputType === 'full' ? Array(candles.length).fill(NaN) : NaN;
    }

    const atrValues = atr(candles, atrPeriod);
    const highestHighValues = highestHigh(candles, hhvPeriod);

    const trailingStop = [];
    for (let i = 0; i < candles.length; i++) {
        if (i < Math.max(atrPeriod, hhvPeriod) - 1) {
            trailingStop.push(NaN);
        } else {
            const stopValue = highestHighValues[i] - (multiplier * atrValues[i]);
            trailingStop.push(stopValue);
        }
    }

    return outputType === 'full' ? trailingStop : trailingStop[trailingStop.length - 1];
}

const atr = (data, period) => {
    const tr = [];
    for (let i = 1; i < data.length; i++) {
        const highLow = data[i].high - data[i].low;
        const highClose = Math.abs(data[i].high - data[i - 1].close);
        const lowClose = Math.abs(data[i].low - data[i - 1].close);
        tr.push(Math.max(highLow, highClose, lowClose));
    }

    const atrValues = [];
    for (let i = period - 1; i < tr.length; i++) {
        const window = tr.slice(i - period + 1, i + 1);
        const mean = window.reduce((sum, value) => sum + value, 0) / period;
        atrValues.push(mean);
    }

    return Array(data.length - atrValues.length).fill(NaN).concat(atrValues);
};

const highestHigh = (data, period) => {
    const highest = [];
    for (let i = period - 1; i < data.length; i++) {
        const window = data.slice(i - period + 1, i + 1);
        const maxHigh = Math.max(...window.map(c => c.high));
        highest.push(maxHigh);
    }
    return Array(data.length - highest.length).fill(NaN).concat(highest);
};

function calculateATRTrailingStopV2(candles, slType, slPerc, atrLength, atrMult, slAbsol, outputType = 'full') {
    if (candles.length < atrLength) {
        return outputType === 'full' ? Array(candles.length).fill(NaN) : NaN;
    }

    const atr = (data, period) => {
        const tr = [];
        for (let i = 1; i < data.length; i++) {
            const highLow = data[i].high - data[i].low;
            const highClose = Math.abs(data[i].high - data[i - 1].close);
            const lowClose = Math.abs(data[i].low - data[i - 1].close);
            tr.push(Math.max(highLow, highClose, lowClose));
        }
        const atrValues = [];
        for (let i = period - 1; i < tr.length; i++) {
            const window = tr.slice(i - period + 1, i + 1);
            const mean = window.reduce((sum, value) => sum + value, 0) / period;
            atrValues.push(mean);
        }
        return Array(data.length - atrValues.length).fill(NaN).concat(atrValues);
    };

    const atrValues = atr(candles, atrLength);
    const trailingStop = [];
    let pos = 0;
    let currentTrailingSL = NaN;

    for (let i = 0; i < candles.length; i++) {
        let slVal = NaN;

        if (i >= atrLength - 1) {
            if (slType === "atr") {
                slVal = atrMult * atrValues[i];
            } else if (slType === "absolute") {
                slVal = slAbsol;
            } else {
                slVal = candles[i].close * slPerc / 100;
            }
        }

        if (i === atrLength - 1 && isNaN(currentTrailingSL)) {
            currentTrailingSL = candles[i].close - slVal;
        }

        const longSignal = pos !== 1 && (i >= atrLength - 1 && candles[i].high > currentTrailingSL);
        const shortSignal = pos !== -1 && (i >= atrLength - 1 && candles[i].low < currentTrailingSL);

        if (longSignal) {
            currentTrailingSL = candles[i].low - slVal;
            pos = 1;
        } else if (shortSignal) {
            currentTrailingSL = candles[i].high + slVal;
            pos = -1;
        } else if (pos === 1) {
            currentTrailingSL = Math.max(candles[i].low - slVal, currentTrailingSL);
        } else if (pos === -1) {
            currentTrailingSL = Math.min(candles[i].high + slVal, currentTrailingSL);
        }

        trailingStop.push(currentTrailingSL);
    }

    return outputType === 'full' ? trailingStop : trailingStop[trailingStop.length - 1];
}

function calculateSuperTrend(candles, period = 10, multiplier = 3, outputType = 'full', direction = 'supertrend') {
  if (candles.length < period * 2) return outputType === 'full' ? [] : null;

  const atr = calculateTrueRange(candles, period, 'full');

  const results = [];
  const Up = [];
  const Down = [];
  const trend = [];
  const SuperTrend = [];
  let changeOfTrend;
  let flag;
  let flagh;

  for (let i = period; i < candles.length; i++) {
    const currentCandle = candles[i];
    const currentAtr = atr[i - period];

    const HL2 = (currentCandle.high + currentCandle.low) / 2;
    Up[i] = HL2 + (multiplier * currentAtr);
    Down[i] = HL2 - (multiplier * currentAtr);

    if (i === period) {
      trend[i] = currentCandle.close > currentCandle.open ? 1 : -1;
    } else {
      if (currentCandle.close > Up[i - 1]) {
        trend[i] = 1;
        if (trend[i - 1] === -1) {
          changeOfTrend = 1;
        }
      } else if (currentCandle.close < Down[i - 1]) {
        trend[i] = -1;
        if (trend[i - 1] === 1) {
          changeOfTrend = 1;
        }
      } else if (trend[i - 1] === 1) {
        trend[i] = 1;
        changeOfTrend = 0;
      } else if (trend[i - 1] === -1) {
        trend[i] = -1;
        changeOfTrend = 0;
      }
    }

    flag = trend[i] < 0 && trend[i - 1] > 0 ? 1 : 0;
    flagh = trend[i] > 0 && trend[i - 1] < 0 ? 1 : 0;

    if (trend[i] > 0 && Down[i] < Down[i - 1]) {
      Down[i] = Down[i - 1];
    }

    if (trend[i] < 0 && Up[i] > Up[i - 1]) {
      Up[i] = Up[i - 1];
    }

    if (flag === 1) {
      Up[i] = HL2 + (multiplier * currentAtr);
    }

    if (flagh === 1) {
      Down[i] = HL2 - (multiplier * currentAtr);
    }

    if (trend[i] === 1) {
      SuperTrend[i] = Down[i];
      if (changeOfTrend === 1) {
        SuperTrend[i - 1] = SuperTrend[i - 2];
        results[i - 1] = { supertrend: SuperTrend[i - 2], direction: trend[i - 2] };
        changeOfTrend = 0;
      }
      results[i] = { supertrend: SuperTrend[i], direction: trend[i] };
    } else if (trend[i] === -1) {
      SuperTrend[i] = Up[i];
      if (changeOfTrend === 1) {
        SuperTrend[i - 1] = SuperTrend[i - 2];
        results[i - 1] = { supertrend: SuperTrend[i - 2], direction: trend[i - 2] };
        changeOfTrend = 0;
      }
      results[i] = { supertrend: SuperTrend[i], direction: trend[i] };
    } else {
      results[i] = null;
    }
  }

  const filteredResults = results.filter(a => a !== null && !isNaN(a.supertrend));

  if (outputType === 'last') {
    if (direction === 'supertrend') {
      return filteredResults.length > 0 ? filteredResults[filteredResults.length - 1].supertrend : null;
    } else {
      return filteredResults.length > 0 ? filteredResults[filteredResults.length - 1].direction : null;
    }
  }

  if (direction === 'supertrend') {
    return filteredResults.map(result => result.supertrend);
  } else {
    return filteredResults.map(result => result.direction);
  }
}

function calculateSAR(candles, step = 0.02, max = 0.2, outputType='full') {
  if (candles.length < 2) return outputType === 'last' ? null : [];

  let sar = candles[0].low;
  let extreme = candles[0].high;
  let accel = step;
  let up = true;
  let result = [];
  let furthest = candles[0];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const prev = candles[i - 1];

    if (i === 1) {
      sar = prev.low;
    }

    if (up) {
      sar += accel * (extreme - sar);
      sar = Math.min(sar, furthest.low, prev.low);

      if (current.high > extreme) {
        extreme = current.high;
        accel = Math.min(accel + step, max);
      }

      if (current.low < sar) {
        up = false;
        sar = extreme;
        extreme = current.low;
        accel = step;
      }
    } else {
      sar -= accel * (sar - extreme);
      sar = Math.max(sar, furthest.high, prev.high);

      if (current.low < extreme) {
        extreme = current.low;
        accel = Math.min(accel + step, max);
      }

      if (current.high > sar) {
        up = true;
        sar = extreme;
        extreme = current.high;
        accel = step;
      }
    }

    result.push(sar);
    furthest = prev;
  }
  if (outputType === 'last') {
    return result.length > 0 ? result[result.length - 1] : null;
  }
  return result;
}


function calculateTickPercentage(ticks, period, type = 'above', outputType = 'full') {
  if (!ticks || ticks.length === 0 || ticks.length < period) {
    console.error("Insufficient ticks data for calculation.");
    return outputType === 'full' ? [] : null;
  }

  let percentages = [];
  
  for (let i = period - 1; i < ticks.length; i++) {
    const windowStart = Math.max(0, i - period + 1);
    const currentWindow = ticks.slice(windowStart, i + 1);
    
    let aboveSum = 0;
    let belowSum = 0;
    let totalSum = 0;
    
    for (let j = 1; j < currentWindow.length; j++) {
      const diff = currentWindow[j] - currentWindow[j - 1];
      if (diff > 0) {
        aboveSum += diff;
      } else if (diff < 0) {
        belowSum += Math.abs(diff);
      }
      totalSum += Math.abs(diff);
    }
    
    let percentage = 0;
    
    if (type === 'above') {
      percentage = totalSum > 0 ? (aboveSum / totalSum) * 100 : 0;
    } else {
      percentage = totalSum > 0 ? (belowSum / totalSum) * 100 : 0;
    }
    
    percentages.push(percentage);
  }
  
  while (percentages.length < ticks.length) {
    percentages.unshift(null);
  }
  
  if (outputType === 'last') {
    return percentages.length > 0 ? percentages[percentages.length - 1] : null;
  }
  
  return percentages;
}

let thelast10digits_digit_list;
let thelast10digits_tickmove_list;
let thelast10digits_change_list;
let thelast10digits_digitmove_list;
let thelast10digits_digitgraph_list;
let digitstatistic_list;
let thelast20digits_digitcater_list;
let thelast20digits_digitevenodd_list;
let thelast10ticks_tick_list;
let thelast10ticks_move_list;
let thelast10ticks_worm_list;
let thelast10ticks_sentiment_list;
let thelast10ticks_change_list;
let thelast10ticks_changeperc_list;
let thelast20tickworm_history_list;
let thelast20tickworm_current_list;
let tick_sma_list;
const showUpAllAboutTick = (eo, ep, eq, er) => {
  let et;
  let eu = btn_run.src.split("/").pop() === "icon_run.png" || btn_run.src.split("/").pop() === "icon_stop.png" && mainWorkspaceCode.indexOf("digitstatistic") != -1;
  if (eu && selData.value == "digitstatistic") {
    document.getElementById("div_digitstatistic").style.display = "block";
  } else {
    document.getElementById("div_digitstatistic").style.display = "none";
  }
  if (eu) {
    let ev = [];
    let ew;
    let ex;
    let ey;
    let ez;
    let fa;
    let fb;
    let fc;
    let fd;
    let fe;
    digitstatistic_list = [];
    for (k = 1; k <= 6; k++) {
      et = ep.slice(digitstatistic_noofticks[k].value * -1);
      ev = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      ez = [];
      fa = [];
      digitstatistic_list[k] = [];
      for (const ff of et) {
        ev[ff] = ev[ff] ? ev[ff] + 1 : 1;
      }
      ex = Math.max(...ev);
      ey = Math.min(...ev);
      for (i = 0; i <= 9; i++) {
        if (ev[i] == ex) {
          ez.push(i);
          document.getElementById("digitstatistic_" + k + "_" + i).style.backgroundColor = colorRise;
        } else {
          if (ev[i] == ey) {
            fa.push(i);
            document.getElementById("digitstatistic_" + k + "_" + i).style.backgroundColor = colorFall;
          } else {
            document.getElementById("digitstatistic_" + k + "_" + i).style.backgroundColor = colorNo;
          }
        }
        ew = (ev[i] / et.length * 100).toFixed(2);
        document.getElementById("digitstatistic_" + k + "_" + i).innerText = ew;
        digitstatistic_list[k][i] = ew * 1;
      }
      document.getElementById("digitstatistic_" + k + "_least").innerText = fa;
      document.getElementById("digitstatistic_" + k + "_most").innerText = ez;
    }
    fe = [];
    fd = [];
    digitstatistic_list[7] = [];
    for (i = 0; i <= 9; i++) {
      fb = true;
      fc = true;
      for (k = 1; k <= 6; k++) {
        var fg = rgbToHex(document.getElementById("digitstatistic_" + k + "_" + i).style.backgroundColor);
        if (fg != colorFall) {
          fb = false;
        }
        if (fg != colorRise) {
          fc = false;
        }
      }
      if (fb) {
        document.getElementById("digitstatistic_summ_" + i).innerText = i;
        document.getElementById("digitstatistic_summ_" + i).style.backgroundColor = colorFall;
        fe.push(i);
        digitstatistic_list[7][i] = i * 1;
      } else {
        if (fc) {
          document.getElementById("digitstatistic_summ_" + i).innerText = i;
          document.getElementById("digitstatistic_summ_" + i).style.backgroundColor = colorRise;
          fd.push(i);
          digitstatistic_list[7][i] = i * 1;
        } else {
          document.getElementById("digitstatistic_summ_" + i).innerText = "";
          document.getElementById("digitstatistic_summ_" + i).style.backgroundColor = "";
          digitstatistic_list[7][i] = "";
        }
      }
    }
    document.getElementById("digitstatistic_summ_least").innerText = fe;
    document.getElementById("digitstatistic_summ_most").innerText = fd;
  }
  let fh;
  let fi;
  let fj;
  let fk;
  let fl;
  let fm;
  let fn = btn_run.src.split("/").pop() === "icon_run.png" || btn_run.src.split("/").pop() === "icon_stop.png" && mainWorkspaceCode.indexOf("thelast10digits") != -1;
  if (fn && selData.value == "thelast10digits") {
    document.getElementById("div_thelast10digits").style.display = "block";
  } else {
    document.getElementById("div_thelast10digits").style.display = "none";
  }
  if (fn) {
    fh = eo.slice(-11);
    fi = ep.slice(-11);
    thelast10digits_digit_list = [];
    thelast10digits_tickmove_list = [];
    thelast10digits_change_list = [];
    thelast10digits_digitmove_list = [];
    thelast10digits_digitgraph_list = [];
    fl = [];
    for (i = 1; i < fi.length; i++) {
      fj = fi.length - i;
      document.getElementById("thelast10digits_digit_" + fj).innerText = fi[i];
      fk = fi[i] - fi[i - 1];
      document.getElementById("thelast10digits_change_" + fj).innerText = (fk > 0 ? "+" : fk < 0 ? "-" : "") + Math.abs(fk);
      document.getElementById("thelast10digits_digitmove_" + fj).innerText = fk > 0 ? "Rise" : fk < 0 ? "Fall" : "No";
      thelast10digits_digitmove_list.push(document.getElementById("thelast10digits_digitmove_" + fj).innerText);
      document.getElementById("thelast10digits_change_" + fj).style.backgroundColor = document.getElementById("thelast10digits_digitmove_" + fj).style.backgroundColor = fk > 0 ? colorRise : fk < 0 ? colorFall : colorNo;
      fk = fh[i] - fh[i - 1];
      document.getElementById("thelast10digits_tickmove_" + fj).innerText = fk > 0 ? "Rise" : fk < 0 ? "Fall" : "No";
      thelast10digits_tickmove_list.push(document.getElementById("thelast10digits_tickmove_" + fj).innerText);
      document.getElementById("thelast10digits_digitgraph_" + fj).innerText = (fk > 0 ? "+" : fk < 0 ? "-" : "") + fi[i];
      document.getElementById("thelast10digits_digit_" + fj).style.backgroundColor = document.getElementById("thelast10digits_tickmove_" + fj).style.backgroundColor = document.getElementById("thelast10digits_digitgraph_" + fj).style.backgroundColor = fk > 0 ? colorRise : fk < 0 ? colorFall : colorNo;
      thelast10digits_digitgraph_list.push(document.getElementById("thelast10digits_digitgraph_" + fj).innerText * 1);
      thelast10digits_digit_list.push(document.getElementById("thelast10digits_digit_" + fj).innerText * 1);
      thelast10digits_change_list.push(document.getElementById("thelast10digits_change_" + fj).innerText * 1);
      fl.push(document.getElementById("thelast10digits_change_" + fj).style.backgroundColor);
    }
    addDataChartLast10Dig_Digit(mainChartLast10Dig_Digit, thelast10digits_digit_list, fl);
    addDataChartLast10Dig_Change(mainChartLast10Dig_Change, thelast10digits_change_list, fl);
  }
  let fo = btn_run.src.split("/").pop() === "icon_run.png" || btn_run.src.split("/").pop() === "icon_stop.png" && mainWorkspaceCode.indexOf("thelast20digits_digitcater") != -1;
  if (fo && selData.value == "thelast20digitscaterzian") {
    document.getElementById("div_thelast20digitscaterzian").style.display = "block";
  } else {
    document.getElementById("div_thelast20digitscaterzian").style.display = "none";
  }
  if (fo) {
    fh = eo.slice(-21);
    fi = ep.slice(-21);
    thelast20digits_digitcater_list = [];
    fm = [];
    for (i = 1; i < fi.length; i++) {
      fj = fi.length - i;
      fk = fh[i] - fh[i - 1];
      document.getElementById("thelast20digits_digitcater_" + fj).innerText = (fk > 0 ? "+" : fk < 0 ? "-" : "") + fi[i];
      document.getElementById("thelast20digits_digitcater_" + fj).style.backgroundColor = fk > 0 ? colorRise : fk < 0 ? colorFall : colorNo;
      thelast20digits_digitcater_list.push(document.getElementById("thelast20digits_digitcater_" + fj).innerText * 1);
      fm.push(document.getElementById("thelast20digits_digitcater_" + fj).style.backgroundColor);
    }
    addDataChart20Cater(mainChart20Cater, thelast20digits_digitcater_list, fm);
  }
  let fp = btn_run.src.split("/").pop() === "icon_run.png" || btn_run.src.split("/").pop() === "icon_stop.png" && mainWorkspaceCode.indexOf("thelast20digits_digitevenodd") != -1;
  if (fp && selData.value == "thelast20digitsevenodd") {
    document.getElementById("div_thelast20digitsevenodd").style.display = "block";
  } else {
    document.getElementById("div_thelast20digitsevenodd").style.display = "none";
  }
  if (fp) {
    fh = eo.slice(-21);
    fi = ep.slice(-21);
    thelast20digits_digitevenodd_list = [];
    for (i = 1; i < fi.length; i++) {
      fj = fi.length - i;
      fk = fh[i] - fh[i - 1];
      document.getElementById("thelast20digits_digitevenodd_" + fj).innerText = fi[i] % 2 == 0 ? "Even" : "Odd";
      document.getElementById("thelast20digits_digitevenodd_" + fj).style.backgroundColor = fk > 0 ? colorRise : fk < 0 ? colorFall : colorNo;
      thelast20digits_digitevenodd_list.push(document.getElementById("thelast20digits_digitevenodd_" + fj).innerText);
    }
  }
  let fq = btn_run.src.split("/").pop() === "icon_run.png" || btn_run.src.split("/").pop() === "icon_stop.png" && mainWorkspaceCode.indexOf("risevsfall") != -1;
  if (fq && selData.value == "risevsfall") {
    document.getElementById("div_risevsfall").style.display = "block";
  } else {
    document.getElementById("div_risevsfall").style.display = "none";
  }
  if (fq) {
    let fr;
    let fs;
    let ft;
    let fu;
    for (k = 1; k <= 6; k++) {
      let fv = risevsfall_noofticks[k].value * 1;
      et = eo.slice(-fv);
      fr = fs = 0;
      for (i = 1; i < et.length; i++) {
        if (et[i - 1] < et[i]) {
          fr++;
        }
      }
      fs = fv - fr;
      ft = fr / fv * 100;
      fu = fs / fv * 100;
      document.getElementById("risevsfall_" + k + "_rise").innerText = document.getElementById("risevsfall_" + k + "_rise").style.width = ft.toFixed(2) + "%";
      document.getElementById("risevsfall_" + k + "_fall").innerText = document.getElementById("risevsfall_" + k + "_fall").style.width = fu.toFixed(2) + "%";
    }
  }
  let fw = btn_run.src.split("/").pop() === "icon_run.png" || btn_run.src.split("/").pop() === "icon_stop.png" && mainWorkspaceCode.indexOf("evenvsodd") != -1;
  if (fw && selData.value == "evenvsodd") {
    document.getElementById("div_evenvsodd").style.display = "block";
  } else {
    document.getElementById("div_evenvsodd").style.display = "none";
  }
  if (fw) {
    let fx;
    let fy;
    let fz;
    let ga;
    for (k = 1; k <= 6; k++) {
      let gb = evenvsodd_noofticks[k].value * 1;
      et = ep.slice(-gb);
      fx = fy = 0;
      for (i = 0; i < et.length; i++) {
        if (et[i] % 2 == 0) {
          fx++;
        }
      }
      fy = gb - fx;
      fz = fx / gb * 100;
      ga = fy / gb * 100;
      document.getElementById("evenvsodd_" + k + "_even").innerText = document.getElementById("evenvsodd_" + k + "_even").style.width = fz.toFixed(2) + "%";
      document.getElementById("evenvsodd_" + k + "_odd").innerText = document.getElementById("evenvsodd_" + k + "_odd").style.width = ga.toFixed(2) + "%";
    }
  }
  let gc = btn_run.src.split("/").pop() === "icon_run.png" || btn_run.src.split("/").pop() === "icon_stop.png" && mainWorkspaceCode.indexOf("overvsunder") != -1;
  if (gc && selData.value == "overvsunder") {
    document.getElementById("div_overvsunder").style.display = "block";
  } else {
    document.getElementById("div_overvsunder").style.display = "none";
  }
  if (gc) {
    let gd;
    let ge;
    let gf;
    let gg;
    for (k = 1; k <= 2; k++) {
      let gh = overvsunder_noofticks[k].value * 1;
      et = ep.slice(-gh);
      gd = ge = 0;
      for (i = 0; i < et.length; i++) {
        if (et[i] > document.getElementById("overvsunder_" + k + "_overdigit").value * 1) {
          gd++;
        }
        if (et[i] < document.getElementById("overvsunder_" + k + "_underdigit").value * 1) {
          ge++;
        }
      }
      gf = gd / gh * 100;
      gg = ge / gh * 100;
      document.getElementById("overvsunder_" + k + "_over").innerText = gf.toFixed(2) + "%";
      document.getElementById("overvsunder_" + k + "_over").style.width = (gf / Math.max(gf, gg) * 100).toFixed(2) + "%";
      document.getElementById("overvsunder_" + k + "_under").innerText = gg.toFixed(2) + "%";
      document.getElementById("overvsunder_" + k + "_under").style.width = (gg / Math.max(gf, gg) * 100).toFixed(2) + "%";
    }
  }
  let gi;
  let gj = btn_run.src.split("/").pop() === "icon_run.png" || btn_run.src.split("/").pop() === "icon_stop.png" && mainWorkspaceCode.indexOf("thelast10ticks") != -1;
  if (gj && selData.value == "thelast10ticks") {
    document.getElementById("div_thelast10ticks").style.display = "block";
  } else {
    document.getElementById("div_thelast10ticks").style.display = "none";
  }
  if (gj) {
    let gk;
    let gl;
    let gm;
    fh = eo.slice(-39);
    thelast10ticks_tick_list = [];
    gl = [];
    thelast10ticks_move_list = [];
    thelast10ticks_worm_list = [];
    thelast10ticks_change_list = [];
    thelast10ticks_sentiment_list = [];
    gm = [];
    thelast10ticks_changeperc_list = [];
    for (i = 29; i < fh.length; i++) {
      fj = fh.length - i;
      document.getElementById("thelast10ticks_tick_" + fj).innerText = fh[i].toFixed(eq);
      document.getElementById("thelast10ticks_move_" + fj).innerText = fh[i - 1] < fh[i] ? "Rise" : fh[i - 1] > fh[i] ? "Fall" : "No";
      document.getElementById("thelast10ticks_tick_" + fj).style.backgroundColor = document.getElementById("thelast10ticks_move_" + fj).style.backgroundColor = fh[i - 1] < fh[i] ? colorRise : fh[i - 1] > fh[i] ? colorFall : colorNo;
      gi = fh.slice(i - 19, i + 1);
      document.getElementById("thelast10ticks_worm_" + fj).innerText = fh[i] == Math.max(...gi) ? "Blue" : fh[i] == Math.min(...gi) ? "Red" : "Green";
      thelast10ticks_worm_list.push(document.getElementById("thelast10ticks_worm_" + fj).innerText);
      document.getElementById("thelast10ticks_worm_" + fj).style.backgroundColor = fh[i] == Math.max(...gi) ? colorRise : fh[i] == Math.min(...gi) ? colorFall : colorWormNo;
      document.getElementById("thelast10ticks_sentiment_" + fj).innerText = fh[i - 3] < fh[i - 2] && fh[i - 2] < fh[i - 1] && fh[i - 1] < fh[i] ? "Rise" : fh[i - 3] > fh[i - 2] && fh[i - 2] > fh[i - 1] && fh[i - 1] > fh[i] ? "Fall" : "No";
      thelast10ticks_sentiment_list.push(document.getElementById("thelast10ticks_sentiment_" + fj).innerText);
      document.getElementById("thelast10ticks_sentiment_" + fj).style.backgroundColor = fh[i - 3] < fh[i - 2] && fh[i - 2] < fh[i - 1] && fh[i - 1] < fh[i] ? colorRise : fh[i - 3] > fh[i - 2] && fh[i - 2] > fh[i - 1] && fh[i - 1] > fh[i] ? colorFall : colorNo;
      fk = fh[i] - fh[i - 1];
      gk = fk / fh[i - 1] * 100;
      document.getElementById("thelast10ticks_change_" + fj).innerText = (fk > 0 ? "+" : fk < 0 ? "-" : "") + Math.abs(fk).toFixed(2);
      document.getElementById("thelast10ticks_%_" + fj).innerText = (fk > 0 ? "+" : fk < 0 ? "-" : "") + Math.abs(gk).toFixed(2);
      thelast10ticks_changeperc_list.push(document.getElementById("thelast10ticks_%_" + fj).innerText * 1);
      document.getElementById("thelast10ticks_change_" + fj).style.backgroundColor = document.getElementById("thelast10ticks_%_" + fj).style.backgroundColor = fk > 0 ? colorRise : fk < 0 ? colorFall : colorNo;
      thelast10ticks_tick_list.push(document.getElementById("thelast10ticks_tick_" + fj).innerText * 1);
      gl.push(document.getElementById("thelast10ticks_tick_" + fj).style.backgroundColor);
      thelast10ticks_move_list.push(document.getElementById("thelast10ticks_move_" + fj).innerText);
      thelast10ticks_change_list.push(document.getElementById("thelast10ticks_change_" + fj).innerText * 1);
      gm.push(document.getElementById("thelast10ticks_change_" + fj).style.backgroundColor);
    }
    addDataChartLast10Tick_Tick(mainChartLast10Tick_Tick, thelast10ticks_tick_list, gl);
    addDataChartLast10Tick_Change(mainChartLast10Tick_Change, thelast10ticks_change_list, gm);
  }
  let gn = btn_run.src.split("/").pop() === "icon_run.png" || btn_run.src.split("/").pop() === "icon_stop.png" && mainWorkspaceCode.indexOf("thelast20tickworm") != -1;
  if (gn && selData.value == "thelast20tickworm") {
    document.getElementById("div_thelast20tickworm").style.display = "block";
  } else {
    document.getElementById("div_thelast20tickworm").style.display = "none";
  }
  if (gn) {
    let go;
    let gp;
    let gq;
    fh = eo.slice(-39);
    thelast20tickworm_history_list = [];
    thelast20tickworm_current_list = [];
    go = [];
    gp = [];
    gq = [];
    for (i = 19; i < fh.length; i++) {
      fj = fh.length - i;
      gi = fh.slice(i - 19, i + 1);
      document.getElementById("thelast20tickworm_history_" + fj).innerText = fh[i] == Math.max(...gi) ? "Blue" : fh[i] == Math.min(...gi) ? "Red" : "Green";
      thelast20tickworm_history_list.push(document.getElementById("thelast20tickworm_history_" + fj).innerText);
      document.getElementById("thelast20tickworm_history_" + fj).style.backgroundColor = fh[i] == Math.max(...gi) ? colorRise : fh[i] == Math.min(...gi) ? colorFall : colorWormNo;
    }
    gi = fh.slice(-20);
    for (i = 19; i < fh.length; i++) {
      fj = fh.length - i;
      document.getElementById("thelast20tickworm_current_" + fj).innerText = fh[i] == Math.max(...gi) ? "Blue" : fh[i] == Math.min(...gi) ? "Red" : "Green";
      document.getElementById("thelast20tickworm_current_" + fj).style.backgroundColor = fh[i] == Math.max(...gi) ? colorRise : fh[i] == Math.min(...gi) ? colorFall : colorWormNo;
      thelast20tickworm_current_list.push(document.getElementById("thelast20tickworm_current_" + fj).innerText);
      go.push(fh[i]);
      gp.push(document.getElementById("thelast20tickworm_current_" + fj).style.backgroundColor);
      if (i != fh.length - 1) {
        gq.push(fh[i] == Math.max(...gi) ? "circle" : fh[i] == Math.min(...gi) ? "circle" : false);
      } else {
        gq.push("circle");
      }
    }
    addDataChart20TickWorm(mainChart20TickWorm, go, gp, gq);
  }
  let gr = btn_run.src.split("/").pop() === "icon_run.png" || btn_run.src.split("/").pop() === "icon_stop.png" && (mainWorkspaceCode.indexOf("tick_sma") != -1 || mainWorkspaceCode.indexOf("TickTrisma") != -1);
  if (gr && selData.value == "tick_Trisma") {
    document.getElementById("div_tick_Trisma").style.display = "block";
  } else {
    document.getElementById("div_tick_Trisma").style.display = "none";
  }
  if (gr) {
    tick_sma_list = [];
    tempArray1 = calculateMovingAverage(eo, inpTickTrisma_period[1].value * 1).slice(-101);
    tempArray2 = calculateMovingAverage(eo, inpTickTrisma_period[2].value * 1).slice(-101);
    tempArray3 = calculateMovingAverage(eo, inpTickTrisma_period[3].value * 1).slice(-101);
    for (i = 81; i < 101; i++) {
      if (tempArray1[i] === undefined || tempArray2[i] === undefined || tempArray3[i] === undefined) break;
      document.getElementById("tick_sma1_" + (101 - i)).innerText = tempArray1[i].toFixed(2);
      document.getElementById("tick_sma1_" + (101 - i)).style.backgroundColor = tempArray1[i - 1] < tempArray1[i] ? colorRise : tempArray1[i - 1] > tempArray1[i] ? colorFall : colorNo;
      document.getElementById("tick_sma2_" + (101 - i)).innerText = tempArray2[i].toFixed(2);
      document.getElementById("tick_sma2_" + (101 - i)).style.backgroundColor = tempArray2[i - 1] < tempArray2[i] ? colorRise : tempArray2[i - 1] > tempArray2[i] ? colorFall : colorNo;
      document.getElementById("tick_sma3_" + (101 - i)).innerText = tempArray3[i].toFixed(2);
      document.getElementById("tick_sma3_" + (101 - i)).style.backgroundColor = tempArray3[i - 1] < tempArray3[i] ? colorRise : tempArray3[i - 1] > tempArray3[i] ? colorFall : colorNo;
    }
    tick_sma_list[1] = tempArray1.slice(-20);
    tick_sma_list[2] = tempArray2.slice(-20);
    tick_sma_list[3] = tempArray3.slice(-20);
    addDataChartticktrisma(mainChartTickTrisma, [eo.slice(-101), tempArray1, tempArray2, tempArray3]);
  }
  let gs = btn_run.src.split("/").pop() === "icon_run.png" || btn_run.src.split("/").pop() === "icon_stop.png" && mainWorkspaceCode.indexOf("detail3ticks") != -1;
  if (gs && selData.value == "detail3ticks") {
    document.getElementById("div_detail3ticks").style.display = "block";
  } else {
    document.getElementById("div_detail3ticks").style.display = "none";
  }
  if (gs) {
    let gt = "";
    et = eo.slice(-3);
    if (et.length < 3) return;
    for (i = 1; i <= 3; i++) {
      gt = et[3 - i].toFixed(eq).substring(0, 13);
      document.getElementById("detail3ticks_" + i + "_tick").innerText = gt;
      for (k = 0; k < 12; k++) {
        if (k < gt.length) {
          document.getElementById("detail3ticks_" + i + "_" + (k + 1)).innerText = gt.charAt(k);
        } else {
          document.getElementById("detail3ticks_" + i + "_" + (k + 1)).innerText = "";
        }
      }
    }
  }
  if (er == "history") {
    sedangForgetAllTicks = false;
  }
  ;
  checkIfReadyToMainLogic();
};
const showUpAboutMultiMarket_Continuous = (gu, gv, gx, gy, gz) => {
  let hb = btn_run.src.split("/").pop() === "icon_run.png" || btn_run.src.split("/").pop() === "icon_stop.png" && mainWorkspaceCode.indexOf("continuousindices") != -1;
  if (hb && selData.value == "continuousindices") {
    document.getElementById("div_continuousindices").style.display = "block";
  } else {
    document.getElementById("div_continuousindices").style.display = "none";
  }
  if (hb) {
    document.getElementById("continuousindices_" + gu + "_ticks").value = gv;
    document.getElementById("continuousindices_" + gu + "_digits").value = gx;
  }
  if (gz == "history") {
    sedangForgetAllTicks = false;
  }
  ;
  if (Date.now() - lastTimeCheckIfReadyToMainLogic_continuousindices[gu] < 500) {
    return;
  }
  ;
  lastTimeCheckIfReadyToMainLogic_continuousindices[gu] = Date.now();
  if (sudahRunOnceAtStart && btn_run.src.split("/").pop() === "icon_stop.png" && !sedangForgetAllTicks && navigator.onLine) {
    updateStepper(1);
        
    const modo = obterModoVirtualLossAtivo();

    if (modo === 'nenhum') {
      // Virtual Loss desativado - usar conta real
      conn_nya = vEval;
    } else {
    // Virtual Loss ativo - verificar se deve usar virtual ou real
    if (emModoVirtual) {
        // Usar conta virtual
        if (!slaveAuthorized) {
          return;
        }
        conn_nya = v;
      } else {
        // Usar conta real
        conn_nya = vEval;
      }
    }
    
    if (Date.now() >= timeMayOP && navigator.onLine && !sedangForgetAllTicks) {
      mainTickArray_continuousindices = gv;
      mainDigitArray_continuousindices = gx;
      mainMarket_continuousindices = arrMarket_Continuous[gu - 1];
      func$1$9$8$7$PurchaseConditions_continuousindices();
    }
  }
};
/*
const showUpCandle = (hc, hd, he) => {
  let hf;
  let hg;
  let hh;
  let hi;
  let hj;
  for (i = 10; i > hd.length; i--) {
    hf = document.getElementById("thelast10candles_" + hc + "_" + i);
    hf.innerText = "";
    hf.style = "";
  }
  for (i = 0; i < hd.length; i++) {
    hf = document.getElementById("thelast10candles_" + hc + "_" + (hd.length - i));
    if (hd[i].close > hd[i].open) {
      hg = "Bull";
      hh = colorRise;
    } else {
      if (hd[i].close < hd[i].open) {
        hg = "Bear";
        hh = colorFall;
      } else {
        hg = "Doji";
        hh = colorNo;
      }
    }
    hf.innerText = hg;
    hf.style.backgroundColor = hh;
  }
  document.getElementById("thelast10candles_" + hc + "_1_open").innerText = hd[hd.length - 1].open.toFixed(he);
  document.getElementById("thelast10candles_" + hc + "_1_high").innerText = hd[hd.length - 1].high.toFixed(he);
  document.getElementById("thelast10candles_" + hc + "_1_low").innerText = hd[hd.length - 1].low.toFixed(he);
  document.getElementById("thelast10candles_" + hc + "_1_close").innerText = hd[hd.length - 1].close.toFixed(he);
  if (hd.length > 1) {
    hi = hd[hd.length - 1].close - hd[hd.length - 2].close;
    hj = hi / hd[hd.length - 2].close * 100;
    document.getElementById("thelast10candles_" + hc + "_1_change").innerText = (hi > 0 ? "+" : hi < 0 ? "-" : "") + Math.abs(hi).toFixed(2);
    document.getElementById("thelast10candles_" + hc + "_1_changepercent").innerText = (hi > 0 ? "+" : hi < 0 ? "-" : "") + Math.abs(hj).toFixed(2);
    document.getElementById("thelast10candles_" + hc + "_1_change").style.backgroundColor = document.getElementById("thelast10candles_" + hc + "_1_changepercent").style.backgroundColor = hi > 0 ? colorRise : hi < 0 ? colorFall : colorNo;
  } else {
    document.getElementById("thelast10candles_" + hc + "_1_change").innerText = document.getElementById("thelast10candles_" + hc + "_1_changepercent").innerText = document.getElementById("thelast10candles_" + hc + "_1_change").style = document.getElementById("thelast10candles_" + hc + "_1_changepercent").style = "";
  }
  checkIfReadyToMainLogic();
};*/


const updateCandleTable = (granularity) => {
    const symbol = mainSymbol;
    
    if (!candleData[symbol]?.[granularity]) return;

    const marketData = candleData[symbol][granularity];
    const pipSize = marketData.current?.pip_size || (symbol.includes('R_') ? 2 : 3);
    const history = marketData.history;
    const current = marketData.current;

    const setElementContent = (id, value) => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = typeof value === 'number' ? 
                value.toFixed(pipSize) : 
                '0.00';
        }
    };

    // 1. Últimas 10 velas completas (histórico real)
    const historicalCandles = history.slice(-10).reverse(); // Pega as 10 últimas completas
    for (let i = 0; i < 10; i++) {
        const candle = historicalCandles[i];
        const position = i + 1;
        const elementId = `thelast10candles_${granularity}_${position}`;
        
        if (candle) {
            setElementContent(elementId, candle.close);
            
            // Estilo de cor
            const change = candle.close - candle.open;
            document.getElementById(elementId).style.backgroundColor = change > 0 ? colorRise : 
                                                                    change < 0 ? colorFall : colorNo;
        } else {
            setElementContent(elementId, '-');
        }
    }

    // 2. Última vela completa (histórico)
    if (history.length > 0) {
        const lastCompleteCandle = history[history.length - 1];
        
        setElementContent(`thelast10candles_${granularity}_1_open`, lastCompleteCandle.open);
        setElementContent(`thelast10candles_${granularity}_1_high`, lastCompleteCandle.high);
        setElementContent(`thelast10candles_${granularity}_1_low`, lastCompleteCandle.low);
        setElementContent(`thelast10candles_${granularity}_1_close`, lastCompleteCandle.close);
    }

    // 3. Vela atual e variação
    if (current) {
        // Atualizar dados da vela atual
        setElementContent(`thelast10candles_${granularity}_1_open`, current.open);
        setElementContent(`thelast10candles_${granularity}_1_high`, current.high);
        setElementContent(`thelast10candles_${granularity}_1_low`, current.low);
        setElementContent(`thelast10candles_${granularity}_1_close`, current.close);

        // Cálculo de variação correto (atual vs última completa)
        if (history.length > 0) {
            const lastCompleteClose = history[history.length - 1].close;
            const change = current.close - lastCompleteClose;
            const changePercent = (change / lastCompleteClose * 100);

            // Elementos de variação
            const changeElement = document.getElementById(`thelast10candles_${granularity}_1_change`);
            const percentElement = document.getElementById(`thelast10candles_${granularity}_1_changepercent`);

            if (changeElement) {
                changeElement.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(pipSize)}`;
            }
            
            if (percentElement) {
                percentElement.textContent = `${change >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`;
            }

            // Estilo de cor
            const changeColor = change > 0 ? colorRise : change < 0 ? colorFall : colorNo;
            if (changeElement) changeElement.style.color = changeColor;
            if (percentElement) percentElement.style.color = changeColor;
        }
    }
    updateCountdowns();
    checkIfReadyToMainLogic();
};

const checkIfReadyToMainLogic = () => {
  if (Date.now() - lastTimeCheckIfReadyToMainLogic < 500) {
    return;
  }
  ;
  lastTimeCheckIfReadyToMainLogic = Date.now();
  if (sudahRunOnceAtStart && btn_run.src.split("/").pop() === "icon_stop.png" && !sedangForgetAllTicks && navigator.onLine) {
    mainLogic();
  } else {
    if (prContract.length != 0) {}
  }
};
const btn_runClickResponse = () => {
  if (btn_run.src.split("/").pop() == "icon_run.png") {
      if (!isAuthValid()) {
      $.notify("Efetuar Login na Corretora", {
        position: "bottom left",
        className: "warn"
      });
        return;
    } else {
      // FIX v004: verificar WS pronto para nova API antes de iniciar
      if (isNewApiUser && (!wsMasterOpened || !vEval || vEval.readyState !== 1 || !wsSlaveOpened || !slaveAuthorized)) {
        $.notify("Aguarde: conexão com o servidor de trading ainda não está pronta. Tente novamente em instantes.", {
          position: "bottom left",
          className: "warn"
        });
        return;
      }
      mainWorkspaceCode = javascript.javascriptGenerator.workspaceToCode(Blockly.getMainWorkspace());
      updateStatusBotRunning("Preparando Bot...");
      ubahbtn_run("stop");
      updateStepper(0);
      // countVLose = 0;
      
      // Resetar Virtual Loss
        resetarVirtualLossState();
        inicializarVirtualLoss();
      
      sudahRunOnceAtStart = false;
      if (getSToken().length > 0) {
        authorizeV();
      }
      authorize();
      getAndEvalJavaScriptCode();
      showBoxSummary();
      document.getElementById("btn_clearBoxSummary").hidden = true;
      updateStatusBotRunning("Bot iniciado");
    }
  } else {
    if (btn_run.src.split("/").pop() == "icon_stop.png") {
      // FIX v004: enviar forget_all ao parar o bot na nova API
      if (isNewApiUser && conn_nya && conn_nya.readyState === 1) {
        try {
          conn_nya.send(JSON.stringify({ forget_all: ["proposal", "proposal_open_contract"] }));
        } catch(e) { console.warn('[NewAPI] Erro ao enviar forget_all ao parar:', e); }
      }
      emptyAllFunc();
      ubahbtn_run("run");
      updateStatusBotRunning("Bot parado");
      sedangAuthorize = false;
      sedangAuthorizeV = false;
      sudahRunOnceAtStart = false;
      timeMayOP = 0;
      document.getElementById("btn_clearBoxSummary").hidden = false;
      refreshBoxData(selData.value);
    }
  }
};
const emptyAllFunc = () => {
  func$1$9$8$7$RunOnceAtStart = () => {
    izinRun2 = false;
  };
  func$1$9$8$7$PurchaseConditions = () => {
    if (izinRun2) {
      izinRun2 = false;
    }
    ;
  };
  func$1$9$8$7$PurchaseConditions_continuousindices = () => {};
  func$1$9$8$7$SellConditions = () => {};
  func$1$9$8$7$RestartTradingConditions = () => {};
};
emptyAllFunc();
const openResponse = () => {
  wsMasterOpened = true;
  console.log("[NewAPI] WS Master aberto com sucesso, readyState:", vEval ? vEval.readyState : 'N/A');
  // FIX v003c: Resetar contador de reconexão quando WS abrir com sucesso
  newApiReconnectAttempts = 0;
  
  if (!isNewApiUser) {
    getSymbols();
    subscribeAllCandles();
  }
  cekWSOpened();
  if (isNewApiUser) {
    // Nova API: já autenticado via OTP — carrega dados da conta do cache REST
    const _acct = masterAccounts[currentMasterIndex] || masterAccounts[0];
    if (_acct) {
      loginID        = _acct.account;
      masterCurrency = _acct.currency;
      isVirtual      = _acct.isDemo ? 1 : 0;
      if (typeof summary_account  !== 'undefined') summary_account.innerText  = String(loginID).slice(0,3) + "***" + String(loginID).slice(-2);
      if (typeof summary2_account !== 'undefined') summary2_account.innerText = String(loginID).slice(0,3) + "***" + String(loginID).slice(-2);
      if (typeof summary3_account !== 'undefined') summary3_account.innerText = String(loginID).slice(0,3) + "***" + String(loginID).slice(-2);
    }
    // Subscreve ao saldo
    if (vEval && vEval.readyState === 1) {
      vEval.send(JSON.stringify({ subscribe: 1, balance: 1 }));
    }
    sedangAuthorize = false;
  } else if (sedangAuthorize) {
    authorize();
  }
};
const openResponseV = () => {
  wsSlaveOpened = true;
  console.log("[NewAPI] WS Slave aberto com sucesso, readyState:", v ? v.readyState : 'N/A');
  // FIX v003c: Resetar contador de reconexão slave quando WS abrir com sucesso
  newApiReconnectAttemptsV = 0;
  
  cekWSOpened();
  if (isNewApiUser) {
    // Nova API: já autenticado via OTP — configura dados do slave
    if (virtualAccount) {
      slaveLoginID  = virtualAccount.account;
      slaveCurrency = virtualAccount.currency;
      slaveIsVirtual = 1;
      slaveAuthorized = true;
    }
    sedangAuthorizeV = false;
  } else if (sedangAuthorizeV) {
    authorizeV();
  }
};
const getSymbols = () => {
  const target = isNewApiUser ? vData1 : vEval;
  if (target?.readyState === 1) {
    target.send(JSON.stringify({
      active_symbols: "brief",
      passthrough: { app_id }
    }));
  }
};
const arrangeSymbols = hk => {
  arrMarket = [];
  arrMarketToSubMarket = [];
  arrSubMarketToSymbol = [];
  for (i = 0; i < hk.active_symbols.length; i++) {
    // Suporte a ambas as versões da API
    // Nova API: underlying_symbol, underlying_symbol_name, pip_size (market/submarket removidos)
    // Legada:   symbol, display_name, pip, market_display_name, submarket_display_name
    const _as = hk.active_symbols[i];
    const _asSymbol    = _as.underlying_symbol     ?? _as.symbol      ?? '';
    const _asName      = _as.underlying_symbol_name ?? _as.display_name ?? _asSymbol;
    const _asMarket    = _as.market_display_name   ?? _as.market      ?? 'Mercado';
    const _asSubMarket = _as.submarket_display_name ?? _as.submarket  ?? _asMarket;

    if (!arrMarket.includes(_asMarket)) {
      arrMarket.push(_asMarket);
    }
    if (!arrMarketToSubMarket.includes(_asMarket + "|" + _asSubMarket)) {
      arrMarketToSubMarket.push(_asMarket + "|" + _asSubMarket);
    }
    if (!arrSubMarketToSymbol.includes(_asSubMarket + "|" + _asName + "|" + _asSymbol)) {
      arrSubMarketToSymbol.push(_asSubMarket + "|" + _asName + "|" + _asSymbol);
    }
  }
  selMarket.innerHTML = "";
  for (i = 0; i < arrMarket.length; i++) {
    el = document.createElement("option");
    el.textContent = arrMarket[i];
    el.value = arrMarket[i];
    selMarket.appendChild(el);
  }
  if (localStorage.getItem("selSymbol") != null) {
    setMarket(localStorage.getItem("selSymbol"));
  } else {
    setMarket("1HZ10V");
  }
};
const setMarket = hl => {
  let hm;
  let hn;
  for (i = 0; i < arrSubMarketToSymbol.length; i++) {
    if (arrSubMarketToSymbol[i].split("|")[2] == hl) {
      hn = arrSubMarketToSymbol[i].split("|")[0];
      break;
    }
  }
  for (i = 0; i < arrMarketToSubMarket.length; i++) {
    if (arrMarketToSubMarket[i].split("|")[1] == hn) {
      hm = arrMarketToSubMarket[i].split("|")[0];
      break;
    }
  }
  selMarket.value = hm;
  fillSubMarket(hn, hl);
};
const fillSubMarket = (ho, hp) => {
  selSubMarket.innerHTML = "";
  for (i = 0; i < arrMarketToSubMarket.length; i++) {
    if (arrMarketToSubMarket[i].split("|")[0] == selMarket.value) {
      el = document.createElement("option");
      el.textContent = arrMarketToSubMarket[i].split("|")[1];
      el.value = arrMarketToSubMarket[i].split("|")[1];
      selSubMarket.appendChild(el);
    }
  }
  if (ho != "none") {
    selSubMarket.value = ho;
  }
  fillSymbol(hp);
};
const fillSymbol = hq => {
  selSymbol.innerHTML = "";
  for (i = 0; i < arrSubMarketToSymbol.length; i++) {
    if (arrSubMarketToSymbol[i].split("|")[0] == selSubMarket.value) {
      el = document.createElement("option");
      el.textContent = arrSubMarketToSymbol[i].split("|")[1];
      el.value = arrSubMarketToSymbol[i].split("|")[2];
      selSymbol.appendChild(el);
    }
  }
  if (hq != "none") {
    selSymbol.value = hq;
  }
  mainSymbol = selSymbol.value;
  document.getElementById("lblMarket").innerText = selSymbol.options[selSymbol.selectedIndex].text;
  localStorage.setItem("selSymbol", selSymbol.value);
  forgetAllTicks();
};
const marketChanged = () => {
  fillSubMarket("none", "none");
};
const subMarketChanged = () => {
  fillSymbol("none");
};
const cekWSOpened = () => {
  const dataReady = isNewApiUser ? (wsData1Opened && wsData2Opened) : true;
  if (!wsSlaveSudahFirstOpened && wsMasterOpened && wsSlaveOpened && dataReady) {
    wsSlaveSudahFirstOpened = true;
    btn_run.disabled = btn_run2.disabled = btnSimpleRun.disabled = false;
    btn_run.style.visibility = btn_run2.style.visibility = btnSimpleRun.style.visibility = "visible";
    btnSimpleRun.style.opacity = 1;
    ubahbtn_run("run");
    spanSimpleRobotName.innerText = (localStorage.getItem("mainRobotName") == null ? "Nenhum" : localStorage.getItem("mainRobotName"));
    writeLog("", "Inicializado.");
  }
};
const closeResponse = () => {
  wsMasterOpened = false;
  if (newApiReconnectTimer) { clearTimeout(newApiReconnectTimer); newApiReconnectTimer = null; }
  
  if (isNewApiUser && newApiAccessToken && masterAccounts.length > 0) {
    // FIX v003: Verificar se token ainda é válido antes de reconectar
    if (isTokenExpired(newApiAccessToken)) {
      console.warn('[NewAPI] Token expirado no closeResponse master, redirecionando para login');
      clearAuthState();
      buildLoginUrl().then(url => window.location.href = url);
      return;
    }
    
    // FIX v003c: Reconexão com backoff exponencial
    // NÃO resetar newApiReconnectAttempts aqui — apenas no openResponse (quando WS abre com sucesso)
    const attempt = newApiReconnectAttempts++;
    if (attempt < MAX_RECONNECT_ATTEMPTS) {
      const delay = Math.pow(2, Math.min(attempt, 4)) * 1000;
      console.log(`[NewAPI] Reconectando master em ${delay}ms (tentativa ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS})`);
      newApiReconnectTimer = setTimeout(async () => {
        try {
          const _ra = masterAccounts[currentMasterIndex] || masterAccounts[0];
          const _ro = await fetch(
            DERIV_REST_BASE + '/trading/v1/options/accounts/' + _ra.account_id + '/otp',
            { method: 'POST', headers: { 'Authorization': 'Bearer ' + newApiAccessToken, 'Deriv-App-ID': DERIV_CLIENT_ID } }
          );
          const _rd = await _ro.json();
          const _ru = _rd.data && _rd.data.url;
          if (_ru) {
            vEval = new window.WebSocket(_ru);
            vEval.addEventListener('open',    openResponse);
            vEval.addEventListener('message', messageResponse);
            vEval.addEventListener('close',   closeResponse);
            // FIX v003c: NÃO resetar contador aqui — apenas quando o WS realmente abrir (openResponse)
          }
        } catch(_re) { console.error('[NewAPI] Falha ao reconectar master:', _re); }
      }, delay);
    } else {
      console.error('[NewAPI] Máximo de tentativas de reconexão master atingido');
      writeLog('', 'Erro: não foi possível reconectar ao servidor de trading.');
    }
  }
};
const closeResponseV = () => {
  wsSlaveOpened = false;
  slaveAuthorized = false;
  
  if (isNewApiUser && newApiAccessToken && virtualAccount) {
    // FIX v003: Verificar se token ainda é válido antes de reconectar
    if (isTokenExpired(newApiAccessToken)) {
      console.warn('[NewAPI] Token expirado no closeResponseV slave, redirecionando para login');
      clearAuthState();
      buildLoginUrl().then(url => window.location.href = url);
      return;
    }
    
    // FIX v003c: Reconexão com backoff exponencial usando contador/timer separados
    const attempt = newApiReconnectAttemptsV++;
    if (attempt < MAX_RECONNECT_ATTEMPTS) {
      const delay = Math.pow(2, Math.min(attempt, 4)) * 1000;
      console.log(`[NewAPI] Reconectando slave em ${delay}ms (tentativa ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS})`);
      newApiReconnectTimerV = setTimeout(async () => {
        try {
          const _sv = await fetch(
            DERIV_REST_BASE + '/trading/v1/options/accounts/' + virtualAccount.account_id + '/otp',
            { method: 'POST', headers: { 'Authorization': 'Bearer ' + newApiAccessToken, 'Deriv-App-ID': DERIV_CLIENT_ID } }
          );
          const _sd = await _sv.json();
          const _su = _sd.data && _sd.data.url;
          if (_su) {
            v = new window.WebSocket(_su);
            v.addEventListener('open',    openResponseV);
            v.addEventListener('message', messageResponseV);
            v.addEventListener('close',   closeResponseV);
            // FIX v003c: NÃO resetar contador aqui — apenas quando o WS realmente abrir (openResponseV)
          }
        } catch(_se) {
          console.error('[NewAPI] Falha ao reconectar slave:', _se);
          // FIX v004: log visível ao usuário
          writeLog('', '[NewAPI] Falha ao reconectar à conta virtual: ' + (_se && _se.message ? _se.message : String(_se)));
        }
      }, delay);
    } else {
      // FIX v004: notificar usuário após esgotar tentativas
      console.error('[NewAPI] Máximo de tentativas de reconexão slave atingido');
      writeLog('', 'Erro crítico: não foi possível reconectar à conta virtual após várias tentativas. Faça login novamente.');
      $.notify('Erro: conexão com conta virtual perdida. Faça login novamente.', { position: 'bottom left', className: 'error' });
    }
  }
};

const authorize = () => {
 // FIX v003: Guard clause explícita para nova API
 if (isNewApiUser) return;
 if (!vEval) return;
    console.log("WS Open Master:", vEval ? vEval.readyState : 'N/A');
 if (!wsMasterOpened || vEval.readyState !== 1) {
 return;
 }
  sedangAuthorize = false;
  if (idSubBalance && idSubBalance.length > 0) {
   vEval.send(JSON.stringify({
     forget: idSubBalance,
     passthrough: { app_id }
   }));
  }
  summary_balance.innerText = "-";
  summary2_balance.innerText = "-";
  summary3_balance.innerText = "-";
  vEval.send(JSON.stringify({
 authorize: getMToken(),
 passthrough: { app_id }
  }));
};

const authorizeV = () => {
 // FIX v003: Guard clause explícita para nova API
 if (isNewApiUser) return;
 if (!v) return;
    console.log("WS Open Slave:", v ? v.readyState : 'N/A');
 if (!wsSlaveOpened || v.readyState !== 1) {
 return;
 }
 sedangAuthorizeV = false;
      v.send(JSON.stringify({
 authorize: getSToken(),
 passthrough: { app_id }
      }));
};

const authorizeV2 = () => {
  //slaveAuthorized = false;
  setTimeout(() => {
    if (vEval.readyState == 1) {
        
        if (idSubBalance && idSubBalance.length > 0) {
        vEval.send(JSON.stringify({
    forget: idSubBalance,
    passthrough: {
      app_id: app_id
    }
  }));
        }
        
        console.log("autorizando Master");
      vEval.send(JSON.stringify({
        authorize: getMToken(),
        passthrough: {
          app_id: app_id
        }
      }));
    } else {
      authorizeV();
      console.log("passando de V2 para authorizeV")
    }
  }, 1000);
};

const authorizeV3 = () => {
  //slaveAuthorized = false;
  setTimeout(() => {
    if (v.readyState == 1) {console.log("autorizando Slave as Master");
      vEval.send(JSON.stringify({
        authorize: getSToken(),
        passthrough: {
          app_id: app_id
        }
      }));
    } else {
      //authorizeV();
      console.log("passando para authorizeV")
    }
  }, 1000);
};

const randomArray = hr => {
  return hr[Math.floor(Math.random() * hr.length)];
};
const mainPurchase = (hs, ht, hu, hv, hw, hx, hy, hz, ia, ib, ic, ie, ig, ii, ij, ik, il, im, io) => {
  if (sedangForgetAllTicks) {
    return;
  }
  updateStepper(2);
  tempDuration = hy == "rt" ? Math.floor(Math.random() * 10) + 1 : hx;
  tempDurationUnit = hy == "rt" ? "t" : hy;
  if (tempDurationUnit == "t") {
    tempDetikPengali = hw.includes("1HZ") ? 1 : 2;
  } else {
    if (tempDurationUnit == "s") {
      tempDetikPengali = 1;
    } else {
      if (tempDurationUnit == "m") {
        tempDetikPengali = 60;
      } else {
        if (tempDurationUnit == "h") {
          tempDetikPengali = 3600;
        } else {
          if (tempDurationUnit == "d") {
            tempDetikPengali = 86400;
          }
        }
      }
    }
  }
  if (hs == "master") {
    conn_nya = vEval;
  } else {
    if (hs == "slave") {
      conn_nya = v;
    }
  }
  ;
  if (ht == "manual") {
    stakeNow = hu;
  }
  ;

  // ── Monta os parâmetros do contrato (compartilhados entre legado e nova API) ──
  const _currency = conn_nya == v ? slaveCurrency : masterCurrency;
  const _symbolField = isNewApiUser ? {underlying_symbol: hw} : {symbol: hw};
  // passthrough carrega os metadados necessários para o handler de buy/proposal
  const _passthrough = {
    app_id: app_id,
    tempDuration: tempDuration,
    tempDetikPengali: tempDetikPengali,
    contract_type: hv,    // necessário na nova API (echo_req do buy não tem parameters)
    stake: parseFloat(stakeNow).toFixed(2)
  };

  let _params = null;  // será preenchido por cada bloco de contrato abaixo

  if (["CALL", "PUT", "CALLE", "PUTE", "ONETOUCH", "NOTOUCH", "DIGITDIFF", "DIGITMATCH", "DIGITOVER", "DIGITUNDER", "VANILLALONGCALL", "VANILLALONGPUT", "TURBOSLONG", "TURBOSSHORT"].includes(hv)) {
    let ip;
    if (["CALL", "PUT", "CALLE", "PUTE", "ONETOUCH", "NOTOUCH", "VANILLALONGCALL", "VANILLALONGPUT", "TURBOSLONG", "TURBOSSHORT"].includes(hv)) {
      ip = hz;
    } else {
      if (["DIGITDIFF", "DIGITMATCH"].includes(hv)) {
        ip = ic;
      } else {
        if (["DIGITOVER"].includes(hv)) {
          ip = ie;
        } else {
          if (["DIGITUNDER"].includes(hv)) {
            ip = ig;
          }
        }
      }
    }
    if (["CALL", "PUT", "CALLE", "PUTE"].includes(hv) && (ip == "+0" || ip == "-0" || ip == 0)) {
      writeLog("", (conn_nya == v ? "[Virtual] " : "") + "Comprando " + hv + " [stake: " + parseFloat(stakeNow).toFixed(2) + ", duration: " + tempDuration + tempDurationUnit + ", " + hw + "]");
      _params = { amount: parseFloat(stakeNow).toFixed(2), basis: "stake", contract_type: hv, currency: _currency, duration: tempDuration, duration_unit: tempDurationUnit, ..._symbolField };
    } else {
      writeLog("", (conn_nya == v ? "[Virtual] " : "") + "Comprando " + hv + " " + ip + " [stake: " + parseFloat(stakeNow).toFixed(2) + ", duration: " + tempDuration + tempDurationUnit + ", " + hw + "]");
      _params = { amount: parseFloat(stakeNow).toFixed(2), barrier: ip, basis: "stake", contract_type: hv, currency: _currency, duration: tempDuration, duration_unit: tempDurationUnit, ..._symbolField };
    }
  } else {
    if (["EXPIRYRANGE", "EXPIRYMISS", "RANGE", "UPORDOWN"].includes(hv)) {
      writeLog("", (conn_nya == v ? "[Virtual] " : "") + "Comprando " + hv + " " + ia + " " + ib + " [stake: " + parseFloat(stakeNow).toFixed(2) + ", duration: " + tempDuration + tempDurationUnit + ", " + hw + "]");
      _params = { amount: parseFloat(stakeNow).toFixed(2), barrier: ia, barrier2: ib, basis: "stake", contract_type: hv, currency: _currency, duration: tempDuration, duration_unit: tempDurationUnit, ..._symbolField };
    } else {
      if (["ASIANU", "ASIAND", "DIGITEVEN", "DIGITODD", "RESETCALL", "RESETPUT", "RUNHIGH", "RUNLOW"].includes(hv)) {
        writeLog("", (conn_nya == v ? "[Virtual] " : "") + "Comprando " + hv + " [stake: " + parseFloat(stakeNow).toFixed(2) + ", duration: " + tempDuration + tempDurationUnit + ", " + hw + "]");
        _params = { amount: parseFloat(stakeNow).toFixed(2), basis: "stake", contract_type: hv, currency: _currency, duration: tempDuration, duration_unit: tempDurationUnit, ..._symbolField };
      } else {
        if (["LBFLOATPUT", "LBFLOATCALL", "LBHIGHLOW"].includes(hv)) {
          writeLog("", (conn_nya == v ? "[Virtual] " : "") + "Comprando " + hv + " [multiplier: " + ii + ", duration: " + tempDuration + tempDurationUnit + ", " + hw + "]");
          _params = { amount: parseFloat(stakeNow).toFixed(2), multiplier: ii, contract_type: hv, currency: _currency, duration: tempDuration, duration_unit: tempDurationUnit, ..._symbolField };
        } else {
          if (["TICKHIGH", "TICKLOW"].includes(hv)) {
            writeLog("", (conn_nya == v ? "[Virtual] " : "") + "Comprando " + hv + " " + ij + " [stake: " + parseFloat(stakeNow).toFixed(2) + ", duration: " + tempDuration + tempDurationUnit + ", " + hw + "]");
            _params = { amount: parseFloat(stakeNow).toFixed(2), selected_tick: ij, basis: "stake", contract_type: hv, currency: _currency, duration: tempDuration, duration_unit: tempDurationUnit, ..._symbolField };
          } else {
            if (["ACCU"].includes(hv)) {
              writeLog("", (conn_nya == v ? "[Virtual] " : "") + "Comprando " + hv + " [stake: " + parseFloat(stakeNow).toFixed(2) + ", growth rate: " + ik + "%, take profit: " + im + ", " + hw + "]");
              _params = { amount: parseFloat(stakeNow).toFixed(2), growth_rate: ik / 100, limit_order: { take_profit: im }, basis: "stake", contract_type: hv, currency: _currency, ..._symbolField };
            } else {
              if (["MULTUP", "MULTDOWN"].includes(hv)) {
                writeLog("", (conn_nya == v ? "[Virtual] " : "") + "Comprando " + hv + " x" + il + " [stake: " + parseFloat(stakeNow).toFixed(2) + ", TP: " + im + ", SL: " + io + ", " + hw + "]");
                _params = { amount: parseFloat(stakeNow).toFixed(2), multiplier: il, limit_order: { take_profit: im, stop_loss: io }, basis: "stake", contract_type: hv, currency: _currency, ..._symbolField };
              }
            }
          }
        }
      }
    }
  }

  if (!_params) return; // tipo de contrato não reconhecido

  // FIX v003: Validar WS antes de enviar
  if (!conn_nya || conn_nya.readyState !== 1) {
    console.error('[Purchase] WebSocket não está pronto (readyState:', conn_nya ? conn_nya.readyState : 'null', ')');
    return;
  }
  
  if (isNewApiUser) {
    // ── Nova API: envia proposal primeiro; o buy é disparado ao receber proposal.id ──
    conn_nya.send(JSON.stringify({
      proposal: 1,
      subscribe: 1,
      ..._params,
      passthrough: _passthrough
    }));
  } else {
    // ── API Legada: buy direto com parameters (comportamento original) ──
    conn_nya.send(JSON.stringify({
      subscribe: 1,
      buy: 1,
      parameters: _params,
      price: 999999,
      passthrough: _passthrough
    }));
  }
};
const funcSellAtMarket = () => {
  conn_nya.send(JSON.stringify({
    sell: prContract[sedangPantauContractPos],
    price: 0
  }));
};

const funcSellAt_multimarket = (cont_id) => {
    //console.log("ID recebido para venda:", cont_id);
    if (cont_id) {
        // Enviando a solicitação de venda
        conn_nya.send(JSON.stringify({
            sell: cont_id,
            price: 0
        }));

        // Removendo o contrato do array arrsellProfitLoss_multimarket
        arrsellProfitLoss_multimarket = arrsellProfitLoss_multimarket.filter(item => 
            item.cont_id !== Number(cont_id) 
        );

        // Adicionando o cont_id vendido ao array arr_multimarketVendido
        arr_multimarketVendido.push(cont_id);
       // console.log(`Contrato ${cont_id} vendido e adicionado ao array de vendidos.`);
        //console.log("Array de vendidos:", arr_multimarketVendido);
        //console.log("Array após remoção:", arrsellProfitLoss_multimarket);
    } else {
        //console.error("Contrato não encontrado para venda.");
    }
};

const removeLostContractsFromMarket = () => {
  // Itera sobre cada ID no array loseContract
  loseContract.forEach(lostId => {
    // Encontra o contrato correspondente no array sellProfitLoss_multimarket
    const contractToRemove = arrsellProfitLoss_multimarket.find(item => 
      item.cont_id === lostId
    );
    
    // Se o contrato for encontrado, remove-o do array
    if (contractToRemove) {
      arrsellProfitLoss_multimarket = arrsellProfitLoss_multimarket.filter(item => 
        item.cont_id !== lostId
      );
      // Adicionando o cont_id vendido ao array arr_multimarketVendido
        arr_multimarketVendido.push(lostId);
      //console.log(`Contrato ${lostId} removido do array sellProfitLoss_multimarket devido à perda.`);
      //console.log("Array após remoção:", arrsellProfitLoss_multimarket);
      //console.log("Array de vendidos:", arr_multimarketVendido);
    }
  });
};

const am = [150,147,132,160,148,156,150,165,89,88].map((c) => String.fromCharCode(c - 49)).join("").concat("w".substring(0,1)) + aj;
const updateResult = (iq, ir, it, iu, iw, ix, iy, iz, ja, jb, jc, jd, je, jmkt) => {
  updateStepper(4);
  tempPrContractPos = prContract.indexOf(iq);
  if (!winContract.includes(iq) && (it >= 0 || ir === "won")) {
    winContract.push(iq);
    rowActive[tempPrContractPos].cells[3].innerText = jd;
    rowActive[tempPrContractPos].cells[4].innerText = iu;
    // FIX v003: Garantir que valores são números
    const _profitMaster = parseFloat(it) || 0;
    const _buyPriceMaster = parseFloat(iu) || 0;
    const _payoutMaster = parseFloat(iw) || 0;
    
    rowActive[tempPrContractPos].cells[5].innerText = _profitMaster;
    rowActive[tempPrContractPos].cells[5].style.color = colorWormNo;
    summary_win.innerText = winContract.length;
    totalProfit += _profitMaster;
    summary_totalstake.innerText = (parseFloat(summary_totalstake.innerText) + _buyPriceMaster).toFixed(2);
    summary_totalpayout.innerText = (parseFloat(summary_totalpayout.innerText) + _buyPriceMaster + _profitMaster).toFixed(2);
    summary_totalprofitloss.innerText = Number(totalProfit).toFixed(2);
    summary_totalprofitloss.style.color = totalProfit > 0 ? colorWormNo : totalProfit < 0 ? colorFall : "#fff";
    
    
    // Resetar contador simples (compatibilidade)
    countVLose = 0;

    // Processar Win Real - VOLTAR PARA VIRTUAL
    const modoAtual = obterModoVirtualLossAtivo();
    if (modoAtual !== 'nenhum') {
    // TODOS os modos: Win Real volta para Virtual
    emModoVirtual = true;
  
    // Resetar contadores específicos de cada modo
    if (modoAtual === 'simples') {
    writeLog(verdeEscuro, "[Virtual Loss Simples] Win Real - Voltando para CONTA VIRTUAL");
    } else if (modoAtual === 'intermediario') {
    countVLoseIntermediarioVirtual = 0;
    countVLoseIntermediarioReal = 0;
    writeLog(verdeEscuro, "[Virtual Loss Intermediário] Win Real - Voltando para CONTA VIRTUAL");
    } else if (modoAtual === 'virtualwin') {
    countVLoseWinVirtual = 0;
    writeLog(verdeEscuro, "[Virtual Win] Win Real - Voltando para CONTA VIRTUAL");
    } else if (modoAtual === 'padrao') {
    padraoVLoseAtualIndex = 0;
    writeLog(verdeEscuro, "[Padrão VW/VL] Win Real - Voltando para CONTA VIRTUAL e resetando padrão");
    }  else if (modoAtual === 'progressivo') {
    // MODO PROGRESSIVO: Win Real incrementa contador OU volta para virtual
    countVLoseProgressivoRealWins++;
    const maxRealWins = parseInt(inpVLoseProgressivoRealWins.value);
    
    writeLog(verdeEscuro, "[Progressivo] Win Real #" + countVLoseProgressivoRealWins + "/" + maxRealWins);
    
    if (countVLoseProgressivoRealWins >= maxRealWins) {
      // Atingiu limite - volta para virtual
      emModoVirtual = true;
      countVLoseProgressivoVirtual = 0;
      countVLoseProgressivoRealWins = 0;
      
      // RESETAR STAKE porque ciclo completou com sucesso
        stakeNow = getStakeBegin();
      
      writeLog(verdeEscuro, "[Progressivo] Limite de wins consecutivos atingido - Voltando para CONTA VIRTUAL");
    } else {
      // Não atingiu limite - permanece em real
      emModoVirtual = false;
      //writeLog(colorWormNo, "[Progressivo] Permanecendo em CONTA REAL (ainda não atingiu limite)");
        }
      }
    }

    tempWinInARow++;
    
    if (chkTP.checked && inpTP.value * 1 != 0 && Number(totalProfit).toFixed(2) * 1 >= inpTP.value * 1) {
      if (btn_run.src.split("/").pop() == "icon_stop.png") {
        btn_run.click();
      }
      writeLog(colorWormNo, "Meta de Lucro Atingida.");
      
      
      setTimeout(() => {
        alert("Meta de Lucro Atingida.");
      }, 500);
    } else {
      if (chkNumOfWin.checked && inpNumOfWin.value * 1 != 0 && summary_win.innerText * 1 >= inpNumOfWin.value * 1) {
        if (btn_run.src.split("/").pop() == "icon_stop.png") {
          btn_run.click();
        }
        writeLog(colorWormNo, "NUMBER OF WIN(S) REACHED.");
        
        
        setTimeout(() => {
          alert("NUMBER OF WIN(S) REACHED.");
        }, 500);
      } else {
        if (chkNumOfRun.checked && inpNumOfRun.value * 1 != 0 && summary_noofruns.innerText * 1 >= inpNumOfRun.value * 1) {
          if (btn_run.src.split("/").pop() == "icon_stop.png") {
            btn_run.click();
          }
          writeLog("", "NUMBER OF RUN(S) REACHED.");
          
          
          setTimeout(() => {
            alert("NUMBER OF RUN(S) REACHED.");
          }, 500);
        } else {
          if (chkNumOfWinInARow.checked && inpNumOfWinInARow.value * 1 != 0 && tempWinInARow >= inpNumOfWinInARow.value * 1) {
            if (btn_run.src.split("/").pop() == "icon_stop.png") {
              btn_run.click();
            }
            writeLog(colorWormNo, "WIN(S) IN A ROW REACHED.");
            
            
            setTimeout(() => {
              alert("WIN(S) IN A ROW REACHED.");
            }, 500);
          } else {
            if (["smartmartingale", "smartcyclestake"].includes(selMoneyManagement.value)) {
              if (chkSmart.checked) {
                if (totalProfit >= totalProfitMax) {
                  totalProfitMax = totalProfit;
                  stakeNow = getStakeBegin();
                }
              } else {
                stakeNow = getStakeBegin();
              }
            }
            timeMayOP = Date.now() + (chkDelayWin.checked ? inpDelayWin.value * 1000 : 0);
          }
        }
      }
    } 
  } else {
    if (!loseContract.includes(iq) && (it < 0 || ir === "lost")) {
      loseContract.push(iq);
      rowActive[tempPrContractPos].cells[3].innerText = jd;
      rowActive[tempPrContractPos].cells[4].innerText = iu;
      // FIX v003: Garantir que valores são números
      const _profitLoss = parseFloat(it) || 0;
      const _buyPriceLoss = parseFloat(iu) || 0;
      
      rowActive[tempPrContractPos].cells[5].innerText = _profitLoss;
      rowActive[tempPrContractPos].cells[5].style.color = colorFall;
      summary_loss.innerText = loseContract.length;
      totalProfit += _profitLoss;
      summary_totalstake.innerText = (parseFloat(summary_totalstake.innerText) + _buyPriceLoss).toFixed(2);
      summary_totalpayout.innerText = (parseFloat(summary_totalpayout.innerText) + _buyPriceLoss + _profitLoss).toFixed(2);
      summary_totalprofitloss.innerText = Number(totalProfit).toFixed(2);
      summary_totalprofitloss.style.color = totalProfit > 0 ? colorWormNo : totalProfit < 0 ? colorFall : "#fff";
      tempWinInARow = 0;
      
      // Processar Loss Real
    const modoAtual = obterModoVirtualLossAtivo();
    if (modoAtual === 'intermediario' && !emModoVirtual) {
    // Modo Intermediário: Loss Real incrementa contador
    countVLoseIntermediarioReal++;
    const maxReal = parseInt(inpVLoseIntermediarioReal.value);
  
    writeLog("", "[Virtual Loss Intermediário] Loss Real #" + countVLoseIntermediarioReal + "/" + maxReal);
  
    if (countVLoseIntermediarioReal >= maxReal) {
    // Atingiu limite de losses reais - volta para virtual
    emModoVirtual = true;
    countVLoseIntermediarioVirtual = 0;
    countVLoseIntermediarioReal = 0;
    writeLog("", "[Virtual Loss Intermediário] Limite de Loss Real atingido - Voltando para CONTA VIRTUAL");
    }} else if (modoAtual === 'progressivo' && !emModoVirtual) {
    // Modo Progressivo: Loss Real volta IMEDIATAMENTE para virtual
        emModoVirtual = true;
        countVLoseProgressivoVirtual = 0;
        countVLoseProgressivoRealWins = 0;
        writeLog("", "[Progressivo] Loss Real - Voltando IMEDIATAMENTE para CONTA VIRTUAL");
    }
      
      tempLossInARow++;
      removeLostContractsFromMarket();
      if (chkSL.checked && inpSL.value * 1 != 0 && Number(totalProfit).toFixed(2) * 1 <= -(inpSL.value * 1)) {
        if (btn_run.src.split("/").pop() == "icon_stop.png") {
          btn_run.click();
        }
        writeLog(colorFall, "STOP LOSS HIT.");
        
        
        setTimeout(() => {
          alert("STOP LOSS HIT.");
        }, 500);
      } else {
        if (chkNumOfLoss.checked && inpNumOfLoss.value * 1 != 0 && summary_loss.innerText * 1 >= inpNumOfLoss.value * 1) {
          if (btn_run.src.split("/").pop() == "icon_stop.png") {
            btn_run.click();
          }
          writeLog(colorFall, "NUMBER OF LOSS(ES) REACHED.");
          
          
          setTimeout(() => {
            alert("NUMBER OF LOSS(ES) REACHED.");
          }, 500);
        } else {
          if (chkNumOfRun.checked && inpNumOfRun.value * 1 != 0 && summary_noofruns.innerText * 1 >= inpNumOfRun.value * 1) {
            if (btn_run.src.split("/").pop() == "icon_stop.png") {
              btn_run.click();
            }
            writeLog("", "NUMBER OF RUN(S) REACHED.");
            
            
            setTimeout(() => {
              alert("NUMBER OF RUN(S) REACHED.");
            }, 500);
          } else {
            if (chkNumOfLossInARow.checked && inpNumOfLossInARow.value * 1 != 0 && tempLossInARow >= inpNumOfLossInARow.value * 1) {
              if (btn_run.src.split("/").pop() == "icon_stop.png") {
                btn_run.click();
              }
              writeLog(colorFall, "LOSS(ES) IN A ROW REACHED.");
              
              
              setTimeout(() => {
                alert("LOSS(ES) IN A ROW REACHED.");
              }, 500);
            } else {
              stakeNow = getStakeAfterLose(Math.abs(it));
              timeMayOP = Date.now() + (chkDelayLose.checked ? inpDelayLose.value * 1000 : 0);
            }
          }
        }
      }
    }
  }
  fillDataLastCont(iu, iw, it, ix, iy, iz, ja, jb, jc, jd, je, jmkt, ir, false);
  func$1$9$8$7$RestartTradingConditions();
  clearTimeout(timerStartPLANB[prContract.indexOf(iq)]);
  clearTimeout(timerDoPLANB[prContract.indexOf(iq)]);
  prContract[prContract.indexOf(iq)] = 0;
};
/*
const updateResultV = (jf, jg, jh, ji, jj, jk, jl, jm, jn, jo, jp, jq, jr, jmktv) => {
  updateStepper(4);
  if (jf != lastContractIdV) {
    tempPrContractPos = prContract.indexOf(jf);
    rowActive[tempPrContractPos].cells[3].innerText = jq;
    // FIX v003: Garantir que jh é número
    const _profitV = parseFloat(jh) || 0;
    if (_profitV >= 0 || jg === "won") {
      rowActive[tempPrContractPos].cells[5].innerText = "Virtual Win";
      rowActive[tempPrContractPos].cells[5].style.color = colorWormNo;
      countVLose = 0;
      timeMayOP = Date.now() + (chkDelayWin.checked ? inpDelayWin.value * 1000 : 0);
    } else {
      if (jh < 0 || jg === "lost") {
        rowActive[tempPrContractPos].cells[5].innerText = "Virtual Loss";
        rowActive[tempPrContractPos].cells[5].style.color = colorFall;
        countVLose++;
        if (chkVLose.checked) {
          writeLog("", "[Virtual] LOSE #" + countVLose + "/" + inpVLose.value);
        }
        ;
        timeMayOP = Date.now() + (chkDelayLose.checked ? inpDelayLose.value * 1000 : 0);
      }
    }
    lastContractIdV = jf;
    fillDataLastCont(ji, jj, jh, jk, jl, jm, jn, jo, jp, jq, jr, jmktv, jg, true);
    func$1$9$8$7$RestartTradingConditions();
    clearTimeout(timerStartPLANB[prContract.indexOf(jf)]);
    clearTimeout(timerDoPLANB[prContract.indexOf(jf)]);
    prContract[prContract.indexOf(jf)] = 0;
  }
};
*/
const updateResultV = (jf, jg, jh, ji, jj, jk, jl, jm, jn, jo, jp, jq, jr, jmktv) => {
  updateStepper(4);
  if (jf != lastContractIdV) {
    tempPrContractPos = prContract.indexOf(jf);
    rowActive[tempPrContractPos].cells[3].innerText = jq;
    
    if (jh >= 0 || jg === "won") {
      rowActive[tempPrContractPos].cells[5].innerText = "Virtual Win";
      rowActive[tempPrContractPos].cells[5].style.color = colorWormNo;
  
      // Processar Win Virtual
      const usarReal = decidirModoVirtualLoss('win');
      emModoVirtual = !usarReal;
      
      // Modo Progressivo: Preservar stake se foi gerado por loss real anterior
        const modoAtual = obterModoVirtualLossAtivo();
        
      timeMayOP = Date.now() + (chkDelayWin.checked ? inpDelayWin.value * 1000 : 0);
        } else {
          if (jh < 0 || jg === "lost") {
        rowActive[tempPrContractPos].cells[5].innerText = "Virtual Loss";
        rowActive[tempPrContractPos].cells[5].style.color = colorFall;
        removeLostContractsFromMarket();
    
        // Processar Loss Virtual
        const usarReal = decidirModoVirtualLoss('loss');
        emModoVirtual = !usarReal;
        /*
        // Modo Progressivo: Quando vai entrar em real após perdas virtuais,
        // verificar se deve usar stake multiplicado (de loss real anterior) ou inicial
        const modoAtual = obterModoVirtualLossAtivo();
        if (modoAtual === 'progressivo' && !emModoVirtual) {
        // Vai entrar em real - verificar se já tem stake multiplicado
        if (stakeNow <= 0 || stakeNow < parseFloat(inpInitStake.value)) {
        // Não tem stake válido, usar inicial
        stakeNow = getStakeBegin();
        writeLog("", "[Progressivo] Entrando em Real - Usando stake inicial: " + stakeNow.toFixed(2));
        } 
        }*/
    
        timeMayOP = Date.now() + (chkDelayLose.checked ? inpDelayLose.value * 1000 : 0);
        }
    }
    
    lastContractIdV = jf;
    fillDataLastCont(ji, jj, jh, jk, jl, jm, jn, jo, jp, jq, jr, jmktv, jg, true);
    func$1$9$8$7$RestartTradingConditions();
    clearTimeout(timerStartPLANB[prContract.indexOf(jf)]);
    clearTimeout(timerDoPLANB[prContract.indexOf(jf)]);
    prContract[prContract.indexOf(jf)] = 0;
  }
};

const doPLANB = js => {
  console.log("doPLANB: " + js);
  if (conn_nya.readyState != 1) {
    timerDoPLANB[prContract.indexOf(js)] =
    
    
    setTimeout(() => {
      doPLANB(js);
    }, timerDoPLANBOffset * 1000);
    return;
  }
  if (prContract.indexOf(js) > -1) {
    if (navigator.onLine) {
      conn_nya.send(JSON.stringify({
        forget_all: ["proposal_open_contract"]
      }));
      conn_nya.send(JSON.stringify({
        subscribe: 1,
        proposal_open_contract: 1,
        contract_id: js
      }));
    }
    timerDoPLANB[prContract.indexOf(js)] =
     
    
    setTimeout(() => {
      doPLANB(js);
    }, timerDoPLANBOffset * 1000);
  } else {}
};
const ubahbtn_run = jt => {
  btn_run.src = btn_run2.src = "image/icon_" + jt + ".png";
  btnSimpleRun.innerHTML = "<img src=\"image/icon_" + jt + "2.png\" style=\"height: 30px;\">&nbsp;&nbsp;" + (jt == "run" ? "Iniciar" : "Parar") + " Bot";
};
window.onbeforeunload = function (ju) {
  return "Você está saindo. Tem certeza?";
};
const updateStepper = jv => {
  for (i = 1; i <= 4; i++) {
    if (i <= jv) {
      divStepper[i].className = "stepper-item completed";
    } else {
      divStepper[i].className = "stepper-item active";
    }
    if (i == jv) {
      divStepper[i].querySelector(".step-counter").classList.add("pulse");
    } else {
      divStepper[i].querySelector(".step-counter").classList.remove("pulse");
    }
  }
};
form.addEventListener("submit", jw => {
  jw.preventDefault();
  let jx = new FormData(form);
  fetch("https://script.google.com/macros/s/AKfycbwzTRRP9Rs9Ch4uLvqWGHmmSzG6apubhQJFUBYRcTOBGTehuXmqFAPY3_b7JVVT2V-EmA/exec", {
    mode: "no-cors",
    method: "POST",
    body: jx
  }).then(jy => {}).then(jx => {}).catch(function (jz) {
    console.log("Request failed", jz);
  });
  return true;
});
const saveDataContract = (ka, kb, kc, kd, ke, kf, kg) => {
  data_001.value = ka;
  data_002.value = kb;
  data_003.value = kc;
  data_004.value = kd;
  data_005.value = ke;
  data_006.value = localStorage.getItem("mainRobotName");
  data_007.value = kf;
  data_008.value = kg;
  aSimp.click();
};
const saveDataContract2 = (kaka, kbkb, kckc, kdkd, keke, kfkf, kgkg, kgkh, kgki, kgkj, kgkk) => {
  data_001.value = kaka;
  data_002.value = kbkb;
  data_003.value = localStorage.getItem("mainRobotName");
  data_004.value = kckc;
  data_005.value = kdkd;
  data_006.value = keke;
  data_007.value = kfkf;
  data_008.value = kgkg;
  data_009.value = kgkh;
  data_010.value = kgki;
  data_011.value = kgkj;
  data_012.value = kgkk;
  aSimp.click();
};
const refreshBoxData = kh => {
  document.getElementById("div_thelast10digits").style.display = "none";
  document.getElementById("div_digitstatistic").style.display = "none";
  document.getElementById("div_thelast20digitscaterzian").style.display = "none";
  document.getElementById("div_thelast20digitsevenodd").style.display = "none";
  document.getElementById("div_evenvsodd").style.display = "none";
  document.getElementById("div_overvsunder").style.display = "none";
  document.getElementById("div_thelast10ticks").style.display = "none";
  document.getElementById("div_thelast20tickworm").style.display = "none";
  document.getElementById("div_risevsfall").style.display = "none";
  document.getElementById("div_thelast10candles").style.display = "none";
  document.getElementById("div_tick_Trisma").style.display = "none";
  document.getElementById("div_detail3ticks").style.display = "none";
  document.getElementById("div_" + kh).style.display = "block";
};
const selectedValue = selData.value ? selData.value : "digitstatistic";
refreshBoxData(selectedValue);

function saveJsonObjToFile(ki, kj) {
  const kk = JSON.stringify(ki);
  const kl = "text/plain";
  const km = document.createElement("a");
  const kn = new Blob([kk], {
    type: kl
  });
  km.href = URL.createObjectURL(kn);
  km.download = kj;
  document.body.appendChild(km);
  km.click();
  km.remove();
}

// Substituir a função existente por esta versão melhorada
function loadFileToJsonObj(file) {
    const reader = new FileReader();
    
    reader.onload = function(event) {
        try {
            const jsonContent = JSON.parse(event.target.result);
            Blockly.serialization.workspaces.load(jsonContent, Blockly.getMainWorkspace());
            
            // Atualizar o nome do robô se disponível
            if (jsonContent.metadata && jsonContent.metadata.name) {
                localStorage.setItem("mainRobotName", jsonContent.metadata.name);
                spanSimpleRobotName.innerText = jsonContent.metadata.name;
            }
            
            $.notify("Bot carregado com sucesso!", "success");
        } catch (error) {
            console.error("Erro ao carregar arquivo:", error);
            $.notify("Erro: Arquivo inválido ou corrompido", "error");
        }
    };
    
    reader.onerror = function() {
        $.notify("Erro ao ler o arquivo", "error");
    };
    
    reader.readAsText(file);
}

function tableToCSV(kq, kr, ks) {
  var kt = [];
  var ku = [];
  var kv;
  var kw;
  var kx;
  var ky;
  if (kr != "") {
    kt.push(kr);
  }
  kx = document.querySelectorAll("#" + kq + " tr");
  for (kv = 0; kv < kx.length; kv++) {
    ky = kx[kv].querySelectorAll("td,th");
    ku = [];
    for (kw = 0; kw < ky.length; kw++) {
      ku.push(ky[kw].innerText);
    }
    kt.push(ku.join(","));
  }
  kt = kt.join("\n");
  downloadCSVFile(kt, ks);
}
function downloadCSVFile(kz, la) {
  var lb = new Blob([kz], {
    type: "text/csv"
  });
  var lc = document.createElement("a");
  lc.download = la;
  var ld = window.URL.createObjectURL(lb);
  lc.href = ld;
  lc.style.display = "none";
  document.body.appendChild(lc);
  lc.click();
  document.body.removeChild(lc);
}
var toolbox = document.getElementById("toolbox");
var options = {
  toolbox: toolbox,
  collapse: true,
  comments: true,
  disable: true,
  maxBlocks: Infinity,
  trashcan: false,
  horizontalLayout: false,
  toolboxPosition: "start",
  css: true,
  media: "https://blockly-demo.appspot.com/static/media/",
  rtl: false,
  scrollbars: true,
  sounds: true,
  oneBasedIndex: true,
  zoom: {
    controls: true,
    wheel: true,
    startScale: 0.85,
    maxScale: 3,
    minScale: 0.3,
    scaleSpeed: 1.05,
    pinch: true
  },
  theme: Blockly.Theme.defineTheme("dark", {
    base: Blockly.Themes.Classic,
    blockStyles: {
      logic_blocks: {
        colourPrimary: colorkid
      },
      math_blocks: {
        colourPrimary: colorkid
      },
      text_blocks: {
        colourPrimary: colorkid
      },
      list_blocks: {
        colourPrimary: colorkid
      },
      variable_blocks: {
        colourPrimary: colorkid
      },
      procedure_blocks: {
        colourPrimary: colorpai
      },
      loop_blocks: {
        colourPrimary: colorkid
      }
    },
    componentStyles: {
      workspaceBackgroundColour: "#10151d",
      toolboxBackgroundColour: "blackBackground",
      toolboxForegroundColour: "#fff",
      flyoutBackgroundColour: "#0e111c",
      flyoutForegroundColour: "#ccc",
      flyoutOpacity: 1,
      scrollbarColour: "#797979",
      insertionMarkerColour: "#222",
      insertionMarkerOpacity: 0.3,
      scrollbarOpacity: 0.4,
      cursorColour: "#d0d0d0",
      blackBackground: "#171c2e"
    }
  })
};
var workspace = Blockly.inject(blocklyDiv, options);
workspace.addChangeListener(Blockly.Events.disableOrphans);
var workspaceBlocks = document.getElementById("workspaceBlocks");
Blockly.Xml.domToWorkspace(workspaceBlocks, workspace);
let arrPopulatedMarket2 = [["Mercado Ativo", "activemarket"], ["Mercado Atual - Sistema Intermercados", "mainMarket_continuousindices"], ["Continuous Indices:Volatility 10 (1s) Index", "1HZ10V|Volatility 10 (1s) Index"], ["Continuous Indices:Volatility 10 Index", "R_10|Volatility 10 Index"], ["Continuous Indices:Volatility 25 (1s) Index", "1HZ25V|Volatility 25 (1s) Index"], ["Continuous Indices:Volatility 25 Index", "R_25|Volatility 25 Index"], ["Continuous Indices:Volatility 50 (1s) Index", "1HZ50V|Volatility 50 (1s) Index"], ["Continuous Indices:Volatility 50 Index", "R_50|Volatility 50 Index"], ["Continuous Indices:Volatility 75 (1s) Index", "1HZ75V|Volatility 75 (1s) Index"], ["Continuous Indices:Volatility 75 Index", "R_75|Volatility 75 Index"], ["Continuous Indices:Volatility 100 (1s) Index", "1HZ100V|Volatility 100 (1s) Index"], ["Continuous Indices:Volatility 100 Index", "R_100|Volatility 100 Index"], ["Continuous Indices:Volatility 150 (1s) Index", "1HZ150V|Volatility 150 (1s) Index"], ["Continuous Indices:Volatility 250 (1s) Index", "1HZ250V|Volatility 250 (1s) Index"], ["Daily Reset Indices:Bear Market Index", "RDBEAR|Bear Market Index"], ["Daily Reset Indices:Bull Market Index", "RDBULL|Bull Market Index"], ["Jump Indices:Jump 10 Index", "JD10|Jump 10 Index"], ["Jump Indices:Jump 25 Index", "JD25|Jump 25 Index"], ["Jump Indices:Jump 50 Index", "JD50|Jump 50 Index"], ["Jump Indices:Jump 75 Index", "JD75|Jump 75 Index"], ["Jump Indices:Jump 100 Index", "JD100|Jump 100 Index"], ["Step Indices:Step Index", "stpRNG|Step Index"], ["Crash/Boom Indices:Crash 300 Index", "CRASH300N|Crash 300 Index"], ["Crash/Boom Indices:Crash 500 Index", "CRASH500|Crash 500 Index"], ["Crash/Boom Indices:Crash 1000 Index", "CRASH1000|Crash 1000 Index"], ["Crash/Boom Indices:Boom 300 Index", "BOOM300N|Boom 300 Index"], ["Crash/Boom Indices:Boom 500 Index", "BOOM500|Boom 500 Index"], ["Crash/Boom Indices:Boom 1000 Index", "BOOM1000|Boom 1000 Index"], ["Major Pairs:AUD/JPY", "frxAUDJPY|AUD/JPY"], ["Major Pairs:AUD/USD", "frxAUDUSD|AUD/USD"], ["Major Pairs:EUR/AUD", "frxEURAUD|EUR/AUD"], ["Major Pairs:EUR/CHF", "frxEURCHF|EUR/CHF"], ["Major Pairs:EUR/GBP", "frxEURGBP|EUR/GBP"], ["Major Pairs:EUR/JPY", "frxEURJPY|EUR/JPY"], ["Major Pairs:EUR/USD", "frxEURUSD|EUR/USD"], ["Major Pairs:GBP/AUD", "frxGBPAUD|GBP/AUD"], ["Major Pairs:GBP/JPY", "frxGBPJPY|GBP/JPY"], ["Major Pairs:GBP/USD", "frxGBPUSD|GBP/USD"], ["Major Pairs:USD/CAD", "frxUSDCAD|USD/CAD"], ["Major Pairs:USD/CHF", "frxUSDCHF|USD/CHF"], ["Major Pairs:USD/JPY", "frxUSDJPY|USD/JPY"], ["Minor Pairs:AUD/CAD", "frxAUDCAD|AUD/CAD"], ["Minor Pairs:AUD/CHF", "frxAUDCHF|AUD/CHF"], ["Minor Pairs:AUD/NZD", "frxAUDNZD|AUD/NZD"], ["Minor Pairs:EUR/NZD", "frxEURNZD|EUR/NZD"], ["Minor Pairs:GBP/CAD", "frxGBPCAD|GBP/CAD"], ["Minor Pairs:GBP/CHF", "frxGBPCHF|GBP/CHF"], ["Minor Pairs:GBP/NOK", "frxGBPNOK|GBP/NOK"], ["Minor Pairs:GBP/NZD", "frxGBPNZD|GBP/NZD"], ["Minor Pairs:NZD/JPY", "frxNZDJPY|NZD/JPY"], ["Minor Pairs:NZD/USD", "frxNZDUSD|NZD/USD"], ["Minor Pairs:USD/MXN", "frxUSDMXN|USD/MXN"], ["Minor Pairs:USD/NOK", "frxUSDNOK|USD/NOK"], ["Minor Pairs:USD/PLN", "frxUSDPLN|USD/PLN"], ["Minor Pairs:USD/SEK", "frxUSDSEK|USD/SEK"], ["Asian indices:Australia 200", "OTC_AS51|Australia 200"], ["Asian indices:Hong Kong 50", "OTC_HSI|Hong Kong 50"], ["Asian indices:Japan 225", "OTC_N225|Japan 225"], ["European indices:Euro 50", "OTC_SX5E|Euro 50"], ["European indices:France 40", "OTC_FCHI|France 40"], ["European indices:Germany 40", "OTC_GDAXI|Germany 40"], ["European indices:Netherlands 25", "OTC_AEX|Netherlands 25"], ["European indices:Swiss 20", "OTC_SSMI|Swiss 20"], ["European indices:UK 100", "OTC_FTSE|UK 100"], ["American indices:US 500", "OTC_SPC|US 500"], ["American indices:US Tech 100", "OTC_NDX|US Tech 100"], ["American indices:Wall Street 30", "OTC_DJI|Wall Street 30"], ["Forex Basket:AUD Basket", "WLDAUD|AUD Basket"], ["Forex Basket:EUR Basket", "WLDEUR|EUR Basket"], ["Forex Basket:GBP Basket", "WLDGBP|GBP Basket"], ["Forex Basket:USD Basket", "WLDUSD|USD Basket"], ["Commodities Basket:Gold Basket", "WLDXAU|Gold Basket"], ["Metals:Gold/USD", "frxXAUUSD|Gold/USD"], ["Metals:Palladium/USD", "frxXPDUSD|Palladium/USD"], ["Metals:Platinum/USD", "frxXPTUSD|Platinum/USD"], ["Metals:Silver/USD", "frxXAGUSD|Silver/USD"], ["Cryptocurrencies:BTC/USD", "cryBTCUSD|BTC/USD"], ["Cryptocurrencies:ETH/USD", "cryETHUSD|ETH/USD"]];
let arrAccount = [["Auto", "auto"], ["Conta Real", "master"], ["Conta Virtual", "slave"]];
let arrStakeAM = [["Auto", "auto"], ["Manual", "manual"]];
let arrPopulatedMarketAccu = [["Mercado Ativo", "activemarket"], ["Mercado Atual - Sistema Intermercados", "mainMarket_continuousindices"], ["Continuous Indices:Volatility 10 (1s) Index", "1HZ10V|Volatility 10 (1s) Index"], ["Continuous Indices:Volatility 10 Index", "R_10|Volatility 10 Index"], ["Continuous Indices:Volatility 25 (1s) Index", "1HZ25V|Volatility 25 (1s) Index"], ["Continuous Indices:Volatility 25 Index", "R_25|Volatility 25 Index"], ["Continuous Indices:Volatility 50 (1s) Index", "1HZ50V|Volatility 50 (1s) Index"], ["Continuous Indices:Volatility 50 Index", "R_50|Volatility 50 Index"], ["Continuous Indices:Volatility 75 (1s) Index", "1HZ75V|Volatility 75 (1s) Index"], ["Continuous Indices:Volatility 75 Index", "R_75|Volatility 75 Index"], ["Continuous Indices:Volatility 100 (1s) Index", "1HZ100V|Volatility 100 (1s) Index"], ["Continuous Indices:Volatility 100 Index", "R_100|Volatility 100 Index"]];


const registerContextMenuItems = () => {
    workspace.configureContextMenu = function (menuOptions, e) { console.log('Menu do workspace carregado');
    const item = {
      text: 'Carregar Blocos',
      enabled: true,
      callback: function () {
        loadBlocks();
      },
      weight: 100,
    };
    menuOptions.push(item);
  };
  Blockly.ContextMenuRegistry.registry.register({
        id: 'download_blocks',
        scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
        weight: 100,
        preconditionFn: (scope) => {
            // Só mostra a opção se for um bloco
            return scope.block ? 'enabled' : 'hidden';
        },
        callback: (scope) => {
            if (scope.block) {
                downloadBlocks(scope.block);
            }
        },
        displayText: 'Baixar Blocos'
    });
};
const downloadBlocks = (block) => {
    const blocksToSave = getBlocksToSave(block);
    const serializedBlocks = blocksToSave.map(b => Blockly.serialization.blocks.save(b));
    const json = JSON.stringify(serializedBlocks);
    
    // Criar um Blob e um link para download
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // Criar link de download
    const a = document.createElement('a');
    a.href = url;
    a.download = 'blocos_salvos.ptpart';
    document.body.appendChild(a); // Adiciona o link ao DOM
    a.click(); // Simula o clique para download
    document.body.removeChild(a); // Remove o link do DOM
    URL.revokeObjectURL(url); // Libera o objeto URL
};
const getBlocksToSave = (block) => {
    // Apenas o bloco raiz, NÃO incluir filhos explicitamente
    return [block];
};
const loadBlocks = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ptpart';
    input.onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (event) => {
            const json = event.target.result;
            const data = JSON.parse(json);
            const workspace = Blockly.getMainWorkspace();

            // Função para coletar variáveis de blocos e sub-blocos
            const collectVariables = (block, variables) => {
                if (block.fields?.VAR) {
                    const varData = block.fields.VAR;
                    if (varData.id && varData.name && !variables.some(v => v.id === varData.id)) {
                        variables.push({ id: varData.id, name: varData.name });
                    }
                }
                // Verificar inputs e sub-blocos
                if (block.inputs) {
                    Object.values(block.inputs).forEach(input => {
                        if (input.block) collectVariables(input.block, variables);
                        if (input.shadow) collectVariables(input.shadow, variables);
                    });
                }
                if (block.next?.block) collectVariables(block.next.block, variables);
            };

            // Função para remover 'disabledReasons' recursivamente
            const removeDisabledReasons = (block) => {
                if (block.disabledReasons) delete block.disabledReasons;
                if (block.inputs) {
                    Object.values(block.inputs).forEach(input => {
                        if (input.block) removeDisabledReasons(input.block);
                        if (input.shadow) removeDisabledReasons(input.shadow);
                    });
                }
                if (block.next?.block) removeDisabledReasons(block.next.block);
            };

            if (Array.isArray(data)) {
                // Modo de carregamento de bloco único (array de blocos)
                const variables = [];
                
                // Processar cada bloco
                data.forEach(blockData => {
                    collectVariables(blockData, variables);
                    removeDisabledReasons(blockData);
                });

                // Criar variáveis no workspace
                variables.forEach(v => {
                    workspace.createVariable(v.name, null, v.id);
                });

                // Adicionar todos os blocos
                data.forEach(blockData => {
                    Blockly.serialization.blocks.append(blockData, workspace);
                });

            } else {
                // Modo de carregamento de workspace completo
                if (data.variables) {
                    data.variables.forEach(v => workspace.createVariable(v.name, null, v.id));
                }
                if (data.blocks?.blocks) {
                    data.blocks.blocks.forEach(blockData => {
                        Blockly.serialization.blocks.append(blockData, workspace);
                    });
                }
            }

            workspace.render();
        };
        reader.readAsText(file);
    };
    input.click();
};


Blockly.defineBlocksWithJsonArray([{
  type: "runonceatstart",
  message0: "%1 1. Executar ao Iniciar: %2 %3",
  args0: [{
    type: "field_image",
    src: "https://pontobots.com/image/icon_start.png",
    width: 25,
    height: 25,
    alt: "*",
    flipRtl: false
  }, {
    type: "input_end_row"
  }, {
    type: "input_statement",
    name: "statement_runonceatstart"
  }],
  colour: colorpai,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.runonceatstart = function (le, lf) {
  var lg = lf.statementToCode(le, "statement_runonceatstart");
  var lh = "func$1$9$8$7$RunOnceAtStart=()=>{izinRun2=false;" + lg + ";stakeNow=getStakeBegin();sudahRunOnceAtStart=true;timeMayOP=Date.now()+600;}";
  return lh;
};
Blockly.defineBlocksWithJsonArray([{
  type: "purchaseconditions",
  message0: "%1 2. Lógica de Compra %2 %3",
  args0: [{
    type: "field_image",
    src: "https://pontobots.com/image/icon_purchase.png",
    width: 25,
    height: 25,
    alt: "*",
    flipRtl: false
  }, {
    type: "input_end_row"
  }, {
    type: "input_statement",
    name: "statement_purchaseconditions"
  }],
  colour: colorpai,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.purchaseconditions = function (li, lj) {
  var lk = lj.statementToCode(li, "statement_purchaseconditions");
  var ll = "func$1$9$8$7$PurchaseConditions=()=>{if(izinRun2){izinRun2=false;" + lk + "};}";
  return ll;
};
Blockly.defineBlocksWithJsonArray([{
  type: "purchaseconditions_continuousindices",
  message0: "%1 2. Lógica de Compra - Sistema Intermercados %2 %3",
  args0: [{
    type: "field_image",
    src: "https://pontobots.com/image/icon_purchase.png",
    width: 25,
    height: 25,
    alt: "*",
    flipRtl: false
  }, {
    type: "input_end_row"
  }, {
    type: "input_statement",
    name: "statement_purchaseconditions"
  }],
  colour: colorpai,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.purchaseconditions_continuousindices = function (lm, ln) {
  var lo = ln.statementToCode(lm, "statement_purchaseconditions");
  var lp = "func$1$9$8$7$PurchaseConditions_continuousindices=()=>{" + lo + "}";
  return lp;
};
Blockly.defineBlocksWithJsonArray([{
  type: "currentmarket_continuousindices",
  message0: "Mercado Atual - Sistema Intermercados",
  args0: [],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.currentmarket_continuousindices = function (lq, lr) {
  var ls = "mainMarket_continuousindices";
  return [ls, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "1001tickslist_continuousindices",
  message0: "1001 Ticks List - Sistema Intermercados",
  args0: [],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock["1001tickslist_continuousindices"] = function (lt, lu) {
  var lv = "mainTickArray_continuousindices";
  return [lv, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "1001lastdigitlist_continuousindices",
  message0: "1001 Last Digit List - Sistema Intermercados",
  args0: [],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock["1001lastdigitlist_continuousindices"] = function (lw, lx) {
  var ly = "mainDigitArray_continuousindices";
  return [ly, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "setactive_continuousindices",
  message0: "Ativar Mercado - Sistema Intermercados %1 %2 #1. Volatility 10(1s) Index %3 %4 #2. Volatility 25(1s) Index %5 %6 #3. Volatility 50(1s) Index %7 %8 #4. Volatility 75(1s) Index %9 %10 #5. Volatility 100(1s) Index %11 %12 #6. Volatility 10 Index %13 %14 #7. Volatility 25 Index %15 %16 #8. Volatility 50 Index %17 %18 #9. Volatility 75 Index %19 %20 #10. Volatility 100 Index",
  args0: [{
    type: "input_end_row"
  }, {
    type: "field_checkbox",
    name: "check_market1_nya",
    checked: true
  }, {
    type: "input_end_row"
  }, {
    type: "field_checkbox",
    name: "check_market2_nya"
  }, {
    type: "input_end_row"
  }, {
    type: "field_checkbox",
    name: "check_market3_nya"
  }, {
    type: "input_end_row"
  }, {
    type: "field_checkbox",
    name: "check_market4_nya"
  }, {
    type: "input_end_row"
  }, {
    type: "field_checkbox",
    name: "check_market5_nya"
  }, {
    type: "input_end_row"
  }, {
    type: "field_checkbox",
    name: "check_market6_nya"
  }, {
    type: "input_end_row"
  }, {
    type: "field_checkbox",
    name: "check_market7_nya"
  }, {
    type: "input_end_row"
  }, {
    type: "field_checkbox",
    name: "check_market8_nya"
  }, {
    type: "input_end_row"
  }, {
    type: "field_checkbox",
    name: "check_market9_nya"
  }, {
    type: "input_end_row"
  }, {
    type: "field_checkbox",
    name: "check_market10_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.setactive_continuousindices = function (lz, ma) {
  for (var mb = 1; mb <= 10; mb++) {
    checkbox_check_market_nya[mb] = lz.getFieldValue("check_market" + mb + "_nya") === "TRUE";
  }
  var mc = "for(var m=1;m<=10;m++){if(continuousindices_active[m].checked!=checkbox_check_market_nya[m]){continuousindices_active[m].checked=checkbox_check_market_nya[m];continuousindices_activeChanged(m,checkbox_check_market_nya[m]);}};";
  return mc;
};
Blockly.defineBlocksWithJsonArray([{
  type: "continuousindices",
  message0: "Índices Intermercados: %1 %2",
  args0: [{
    type: "field_dropdown",
    name: "dropdown_continuousindices_A",
    options: [["#1. Volatility 10(1s) Index", "1"], ["#2. Volatility 25(1s) Index", "2"], ["#3. Volatility 50(1s) Index", "3"], ["#4. Volatility 75(1s) Index", "4"], ["#5. Volatility 100(1s) Index", "5"], ["#6. Volatility 10 Index", "6"], ["#7. Volatility 25 Index", "7"], ["#8. Volatility 50 Index", "8"], ["#9. Volatility 75 Index", "9"], ["#10. Volatility 100 Index", "10"]]
  }, {
    type: "field_dropdown",
    name: "dropdown_continuousindices_B",
    options: [["1001 Ticks List", "ticks"], ["1001 Last Digit List", "digits"], ["Symbol", "symbol"]]
  }],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.continuousindices = function (md, me) {
  var mf = md.getFieldValue("dropdown_continuousindices_A");
  var mg = md.getFieldValue("dropdown_continuousindices_B");
  var mh;
  if (mg == "symbol") {
    mh = "document.getElementById(\"continuousindices_" + mf + "_" + mg + "\").innerText";
  } else {
    mh = "(document.getElementById(\"continuousindices_" + mf + "_active\").checked)?document.getElementById(\"continuousindices_" + mf + "_" + mg + "\").value:\"\"";
  }
  return [mh, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "sellconditions",
  message0: "%1 3. Condições de Venda (Sell) %2 %3",
  args0: [{
    type: "field_image",
    src: "https://pontobots.com/image/icon_dollarsack.png",
    width: 25,
    height: 25,
    alt: "*",
    flipRtl: false
  }, {
    type: "input_end_row"
  }, {
    type: "input_statement",
    name: "statement_sellconditions"
  }],
  colour: colorpai,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.sellconditions = function (mi, mj) {
  var mk = mj.statementToCode(mi, "statement_sellconditions");
  var ml = "func$1$9$8$7$SellConditions=()=>{" + mk + "}";
  return ml;
};
Blockly.defineBlocksWithJsonArray([{
  type: "sellisavailable",
  message0: "Sell is available",
  args0: [],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.sellisavailable = function (mm, mn) {
  var mo = "(isContractValidToSell[sedangPantauContractPos]==1)?true:false";
  return [mo, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "sellprofitloss",
  message0: "Sell profit/loss",
  args0: [],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.sellprofitloss = function (mp, mq) {
  var mr = "sellProfitLoss[sedangPantauContractPos]";
  return [mr, Blockly.JavaScript.ORDER_NONE];
};

Blockly.defineBlocksWithJsonArray([{
  type: "sellprofitloss_multimarket",
  message0: "Sell profit/loss for market: %1 Contract: %2",
  args0: [
    {
      type: "field_dropdown",
      name: "market",
      options: arrPopulatedMarketAccu // Lista de mercados disponíveis
    },
    {
      type: "field_dropdown",
      name: "contractType",
      options: [["Multiply Up", "MULTUP"],["Multiply Down", "MULTDOWN"],["Higher/Rise", "CALL"],["Lower/Fall", "PUT"],["Rise Equals", "CALLE"],["Fall Equals", "PUTE"]
      ]
    }
  ],
  output: null,
  colour: colorkid,
  tooltip: "Retorna o lucro ou perda do contrato aberto para o mercado e tipo selecionados.",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.sellprofitloss_multimarket = function (block) {
  var market = block.getFieldValue('market');
  var contractType = block.getFieldValue('contractType');
  
  // Inicializa a variável finalSymbol
  let finalSymbol;

  // Verifica se o mercado é um dos casos especiais
  if (market === "activemarket") {
    finalSymbol = "mainSymbol";
  } else if (market === "mainMarket_continuousindices") {
    finalSymbol = "mainMarket_continuousindices";
  } else {
    // Extrai o valor antes do pipe (ex: "R_10" de "R_10|Volatility 10 Index")
    const marketEntry = arrPopulatedMarketAccu.find(m => m[1] === market);
    finalSymbol = marketEntry ? `'${marketEntry[1].split('|')[0]}'` : `'${market}'`;
  }
    //console.log(finalSymbol);
  // Acessar o lucro/perda do contrato para o mercado e tipo específico
  var profitLossVariable = `arrsellProfitLoss_multimarket.find(item => item.market_symbol === ${finalSymbol} && item.cont_type === "${contractType}")`;

  // Retornar o lucro/perda se o mercado e tipo corresponderem
  return [`(${profitLossVariable}) ? ${profitLossVariable}.cont_profit : null`, Blockly.JavaScript.ORDER_NONE];
};

Blockly.defineBlocksWithJsonArray([{
  type: "sellatmarket",
  message0: "Sell at market",
  args0: [],
  previousStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.sellatmarket = function (ms, mt) {
  var mu = "funcSellAtMarket();";
  return mu;
};

Blockly.defineBlocksWithJsonArray([{
  type: "sellat_multimarket",
  message0: "Sell at market for market: %1 Contract: %2",
  args0: [
    {
      type: "field_dropdown",
      name: "market",
      options: arrPopulatedMarketAccu // Lista de mercados disponíveis
    },
    {
      type: "field_dropdown",
      name: "contractType",
      options: [["Multiply Up", "MULTUP"],["Multiply Down", "MULTDOWN"],["Higher/Rise", "CALL"],["Lower/Fall", "PUT"],["Rise Equals", "CALLE"],["Fall Equals", "PUTE"]]
    }
  ],
  previousStatement: null,
  colour: colorkid,
  tooltip: "Vende o contrato ativo para o mercado e tipo selecionados.",
  helpUrl: ""
}]);

javascript.javascriptGenerator.forBlock.sellat_multimarket = function (block) {
  var market = block.getFieldValue('market');
  var contractType = block.getFieldValue('contractType');
  
  // Lógica para determinar o finalSymbol
  let finalSymbol;
  if (market === "activemarket") {
    finalSymbol = "mainSymbol";
  } else if (market === "mainMarket_continuousindices") {
    finalSymbol = "mainMarket_continuousindices";
  } else {
    const marketEntry = arrPopulatedMarketAccu.find(m => m[1] === market);
    finalSymbol = marketEntry ? `'${marketEntry[1].split('|')[0]}'` : `'${market}'`;
  }

  // Código para buscar o cont_id e chamar a função de venda
  var code = `
    (() => {
      const contract = arrsellProfitLoss_multimarket.find(item => 
        item.market_symbol === ${finalSymbol} && 
        item.cont_type === "${contractType}"
      );
      funcSellAt_multimarket(contract ? contract.cont_id : null);
    })()
  `;

  return code;
};


Blockly.defineBlocksWithJsonArray([{
  type: "restarttradingconditions",
  message0: "%1 4. Lógica de Recompra %2 %3",
  args0: [{
    type: "field_image",
    src: "https://pontobots.com/image/icon_finish.png",
    width: 25,
    height: 25,
    alt: "*",
    flipRtl: false
  }, {
    type: "input_end_row"
  }, {
    type: "input_statement",
    name: "statement_restarttradingconditions"
  }],
  colour: colorpai,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.restarttradingconditions = function (mv, mw) {
  var mx = mw.statementToCode(mv, "statement_restarttradingconditions");
  var my = "func$1$9$8$7$RestartTradingConditions=()=>{" + mx + "}";
  return my;
};
Blockly.defineBlocksWithJsonArray([{
  type: "lastcontractdetail",
  message0: "Detalhes do último contrato: %1",
  args0: [{
    type: "field_dropdown",
    name: "dropdown_lastcontractdetail_A",
    options: [["Ask price", "askprice"], ["Payout", "payout"], ["Profit", "profit"], ["Contract type", "contracttype"], ["Entry time", "entrytime"], ["Entry value", "entryvalue"], ["Entry value string", "entryvaluestring"], ["Exit time", "exittime"], ["Exit value", "exitvalue"], ["Exit value string", "exitvaluestring"], ["Barrier", "barrier"], ["Result", "result"], ["Market", "market"]]
  }],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.lastcontractdetail = function (mz, na) {
  var nb = mz.getFieldValue("dropdown_lastcontractdetail_A");
  var nd = "lastCont_" + nb;
  if (["askprice", "payout", "profit", "entryvalue", "exitvalue"].includes(nb)) {
    nd += "*1";
  }
  return [nd, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "lastdigit",
  message0: "Último Dígito",
  args0: [],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.lastdigit = function (ne, nf) {
  var ng = "digitArrayUtama.at(-1)*1";
  return [ng, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "1001lastdigitlist",
  message0: "1001 Last Digit List",
  args0: [],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock["1001lastdigitlist"] = function (nh, ni) {
  var nj = "digitArrayUtama";
  return [nj, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "thelast10digits",
  message0: "Last 10 digits: %1 %2",
  args0: [{
    type: "field_dropdown",
    name: "dropdown_thelast10digits_A",
    options: [["Digit", "digit"], ["Tick move", "tickmove"], ["Change", "change"], ["Digit move", "digitmove"], ["Digit caterzian", "digitgraph"]]
  }, {
    type: "field_dropdown",
    name: "dropdown_thelast10digits_B",
    options: [["List", "list"], ["10th", "10"], ["9th", "9"], ["8th", "8"], ["7th", "7"], ["6th", "6"], ["5th", "5"], ["4th", "4"], ["3rd", "3"], ["2nd", "2"], ["1st", "1"]]
  }],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.thelast10digits = function (nk, nl) {
  var nm = nk.getFieldValue("dropdown_thelast10digits_A");
  var nn = nk.getFieldValue("dropdown_thelast10digits_B");
  var np;
  if (nn == "list") {
    np = "thelast10digits_" + nm + "_list";
  } else {
    np = "document.getElementById(\"thelast10digits_" + nm + "_" + nn + "\").innerText";
    if (["digit", "change", "digitgraph"].includes(nm)) {
      np += "*1";
    }
  }
  return [np, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "digitstatisticsetnoofticks",
  message0: "Digit statistic | Set %1 : %2 ticks",
  args0: [{
    type: "field_dropdown",
    name: "row_nya",
    options: [["Row#1", "1"], ["Row#2", "2"], ["Row#3", "3"], ["Row#4", "4"], ["Row#5", "5"], ["Row#6", "6"]]
  }, {
    type: "input_value",
    name: "ticks_nya"
  }],
  inputsInline: true,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.digitstatisticsetnoofticks = function (nq, nr) {
  var ns = nq.getFieldValue("row_nya");
  var nt = nr.valueToCode(nq, "ticks_nya", javascript.Order.ATOMIC);
  var nu = "digitstatistic_noofticks[" + ns + "].value=" + nt + "*1;";
  return nu;
};
Blockly.defineBlocksWithJsonArray([{
  type: "digitstatistic",
  message0: "Digit statistic: %1 %2",
  args0: [{
    type: "field_dropdown",
    name: "dropdown_digitstatistic_A",
    options: [["Row#1", "1"], ["Row#2", "2"], ["Row#3", "3"], ["Row#4", "4"], ["Row#5", "5"], ["Row#6", "6"], ["Summary", "summ"]]
  }, {
    type: "field_dropdown",
    name: "dropdown_digitstatistic_B",
    options: [["List", "list"], ["Digit 0", "0"], ["Digit 1", "1"], ["Digit 2", "2"], ["Digit 3", "3"], ["Digit 4", "4"], ["Digit 5", "5"], ["Digit 6", "6"], ["Digit 7", "7"], ["Digit 8", "8"], ["Digit 9", "9"], ["Least", "least"], ["Most", "most"]]
  }],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.digitstatistic = function (nv, nw) {
  var nx = nv.getFieldValue("dropdown_digitstatistic_A");
  var ny = nv.getFieldValue("dropdown_digitstatistic_B");
  var nz;
  if (ny == "list") {
    if (nx == "summ") {
      nz = "digitstatistic_list[7]";
    } else {
      nz = "digitstatistic_list[" + nx + "]";
    }
  } else {
    nz = "document.getElementById(\"digitstatistic_" + nx + "_" + ny + "\").innerText";
    if (["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].includes(ny)) {
      nz += "*1";
    }
  }
  return [nz, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "caterzian20",
  message0: "Caterzianos 20: %1",
  args0: [{
    type: "field_dropdown",
    name: "dropdown_caterzian20_B",
    options: [["List", "list"], ["20th", "20"], ["19th", "19"], ["18th", "18"], ["17th", "17"], ["16th", "16"], ["15th", "15"], ["14th", "14"], ["13th", "13"], ["12th", "12"], ["11th", "11"], ["10th", "10"], ["9th", "9"], ["8th", "8"], ["7th", "7"], ["6th", "6"], ["5th", "5"], ["4th", "4"], ["3rd", "3"], ["2nd", "2"], ["1st", "1"]]
  }],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.caterzian20 = function (oa, ob) {
  var oc = oa.getFieldValue("dropdown_caterzian20_B");
  var od;
  if (oc == "list") {
    od = "thelast20digits_digitcater_list";
  } else {
    od = "document.getElementById(\"thelast20digits_digitcater_" + oc + "\").innerText*1";
  }
  return [od, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "evenodd20",
  message0: "Even / Odd 20: %1",
  args0: [{
    type: "field_dropdown",
    name: "dropdown_evenodd20_B",
    options: [["List", "list"], ["20th", "20"], ["19th", "19"], ["18th", "18"], ["17th", "17"], ["16th", "16"], ["15th", "15"], ["14th", "14"], ["13th", "13"], ["12th", "12"], ["11th", "11"], ["10th", "10"], ["9th", "9"], ["8th", "8"], ["7th", "7"], ["6th", "6"], ["5th", "5"], ["4th", "4"], ["3rd", "3"], ["2nd", "2"], ["1st", "1"]]
  }],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.evenodd20 = function (oe, og) {
  var oh = oe.getFieldValue("dropdown_evenodd20_B");
  var oi;
  if (oh == "list") {
    oi = "thelast20digits_digitevenodd_list";
  } else {
    oi = "document.getElementById(\"thelast20digits_digitevenodd_" + oh + "\").innerText";
  }
  return [oi, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "evenvsoddsetnoofticks",
  message0: "Even VS Odd | Set %1 : %2 ticks",
  args0: [{
    type: "field_dropdown",
    name: "row_nya",
    options: [["Row#1", "1"], ["Row#2", "2"], ["Row#3", "3"], ["Row#4", "4"], ["Row#5", "5"], ["Row#6", "6"]]
  }, {
    type: "input_value",
    name: "ticks_nya"
  }],
  inputsInline: true,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.evenvsoddsetnoofticks = function (oj, ol) {
  var om = oj.getFieldValue("row_nya");
  var oo = ol.valueToCode(oj, "ticks_nya", javascript.Order.ATOMIC);
  var op = "evenvsodd_noofticks[" + om + "].value=" + oo + "*1;";
  return op;
};
Blockly.defineBlocksWithJsonArray([{
  type: "evenvsodd",
  message0: "Even VS Odd: %1 %2",
  args0: [{
    type: "field_dropdown",
    name: "dropdown_evenvsodd_A",
    options: [["Row#1", "1"], ["Row#2", "2"], ["Row#3", "3"], ["Row#4", "4"], ["Row#5", "5"], ["Row#6", "6"]]
  }, {
    type: "field_dropdown",
    name: "dropdown_evenvsodd_B",
    options: [["Even(%)", "even"], ["Odd(%)", "odd"]]
  }],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.evenvsodd = function (oq, os) {
  var ot = oq.getFieldValue("dropdown_evenvsodd_A");
  var ou = oq.getFieldValue("dropdown_evenvsodd_B");
  var ov = "document.getElementById(\"evenvsodd_" + ot + "_" + ou + "\").innerText.replaceAll(\"%\",\"\")*1";
  return [ov, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "overvsundersetnoofticks",
  message0: "Over VS Under | Set %1 : %2 ticks",
  args0: [{
    type: "field_dropdown",
    name: "row_nya",
    options: [["Row#1", "1"], ["Row#2", "2"]]
  }, {
    type: "input_value",
    name: "ticks_nya"
  }],
  inputsInline: true,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.overvsundersetnoofticks = function (ow, ox) {
  var oy = ow.getFieldValue("row_nya");
  var oz = ox.valueToCode(ow, "ticks_nya", javascript.Order.ATOMIC);
  var pa = "overvsunder_noofticks[" + oy + "].value=" + oz + "*1;";
  return pa;
};
Blockly.defineBlocksWithJsonArray([{
  type: "overvsundersetdigit",
  message0: "Over VS Under | Set %1 %2 %3",
  args0: [{
    type: "field_dropdown",
    name: "row_nya",
    options: [["Row 1", "1"], ["Row 2", "2"]]
  }, {
    type: "field_dropdown",
    name: "type_nya",
    options: [["Over", "over"], ["Under", "under"]]
  }, {
    type: "input_value",
    name: "digit_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.overvsundersetdigit = function (pb, pc) {
  var pd = pb.getFieldValue("row_nya");
  var pe = pb.getFieldValue("type_nya");
  var pf = pc.valueToCode(pb, "digit_nya", javascript.Order.ATOMIC);
  var pg = "document.getElementById(\"overvsunder_" + pd + "_" + pe + "digit\").value=" + pf + ";";
  return pg;
};
Blockly.defineBlocksWithJsonArray([{
  type: "overvsunder",
  message0: "Over VS Under: %1 %2",
  args0: [{
    type: "field_dropdown",
    name: "dropdown_overvsunder_A",
    options: [["Row#1", "1"], ["Row#2", "2"]]
  }, {
    type: "field_dropdown",
    name: "dropdown_overvsunder_B",
    options: [["Over(%)", "over"], ["Under(%)", "under"]]
  }],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.overvsunder = function (ph, pi) {
  var pj = ph.getFieldValue("dropdown_overvsunder_A");
  var pk = ph.getFieldValue("dropdown_overvsunder_B");
  var pl = "document.getElementById(\"overvsunder_" + pj + "_" + pk + "\").innerText.replaceAll(\"%\",\"\")*1";
  return [pl, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "lasttick",
  message0: "Último Tick",
  args0: [],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.lasttick = function (pm, pn) {
  var po = "tickArrayUtama.at(-1)*1";
  return [po, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "lasttickstring",
  message0: "Último Tick String",
  args0: [],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.lasttickstring = function (pp, pq) {
  var ps = "tickArrayUtamaText.at(-1)";
  return [ps, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "1001tickslist",
  message0: "1001 Ticks List",
  args0: [],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock["1001tickslist"] = function (pt, pu) {
  var pv = "tickArrayUtama";
  return [pv, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "1001ticksstringlist",
  message0: "1001 Ticks String List",
  args0: [],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock["1001ticksstringlist"] = function (pw, py) {
  var pz = "tickArrayUtamaText";
  return [pz, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "thelast10ticks",
  message0: "Last 10 ticks: %1 %2",
  args0: [{
    type: "field_dropdown",
    name: "dropdown_thelast10ticks_A",
    options: [["Tick", "tick"], ["Move", "move"], ["Worm", "worm"], ["Sentiment", "sentiment"], ["Change", "change"], ["%", "%"]]
  }, {
    type: "field_dropdown",
    name: "dropdown_thelast10ticks_B",
    options: [["List", "list"], ["10th", "10"], ["9th", "9"], ["8th", "8"], ["7th", "7"], ["6th", "6"], ["5th", "5"], ["4th", "4"], ["3rd", "3"], ["2nd", "2"], ["1st", "1"]]
  }],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.thelast10ticks = function (qa, qb) {
  var qc = qa.getFieldValue("dropdown_thelast10ticks_A");
  var qd = qa.getFieldValue("dropdown_thelast10ticks_B");
  var qe;
  if (qd == "list") {
    if (qc == "%") {
      qe = "thelast10ticks_changeperc_list";
    } else {
      qe = "thelast10ticks_" + qc + "_list";
    }
  } else {
    qe = "document.getElementById(\"thelast10ticks_" + qc + "_" + qd + "\").innerText";
    if (["tick", "change", "%"].includes(qc)) {
      qe += "*1";
    }
  }
  return [qe, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "tickworm20",
  message0: "Worm 20: %1 %2",
  args0: [{
    type: "field_dropdown",
    name: "dropdown_tickworm20_A",
    options: [["History (worm head)", "history"], ["Current", "current"]]
  }, {
    type: "field_dropdown",
    name: "dropdown_tickworm20_B",
    options: [["List", "list"], ["20th", "20"], ["19th", "19"], ["18th", "18"], ["17th", "17"], ["16th", "16"], ["15th", "15"], ["14th", "14"], ["13th", "13"], ["12th", "12"], ["11th", "11"], ["10th", "10"], ["9th", "9"], ["8th", "8"], ["7th", "7"], ["6th", "6"], ["5th", "5"], ["4th", "4"], ["3rd", "3"], ["2nd", "2"], ["1st", "1"]]
  }],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.tickworm20 = function (qg, qh) {
  var qi = qg.getFieldValue("dropdown_tickworm20_A");
  var qj = qg.getFieldValue("dropdown_tickworm20_B");
  var qk;
  if (qj == "list") {
    qk = "thelast20tickworm_" + qi + "_list";
  } else {
    qk = "document.getElementById(\"thelast20tickworm_" + qi + "_" + qj + "\").innerText";
  }
  return [qk, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "risevsfallsetnoofticks",
  message0: "Rise VS Fall | Set %1 : %2 ticks",
  args0: [{
    type: "field_dropdown",
    name: "row_nya",
    options: [["Row#1", "1"], ["Row#2", "2"], ["Row#3", "3"], ["Row#4", "4"], ["Row#5", "5"], ["Row#6", "6"]]
  }, {
    type: "input_value",
    name: "ticks_nya"
  }],
  inputsInline: true,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.risevsfallsetnoofticks = function (ql, qm) {
  var qn = ql.getFieldValue("row_nya");
  var qo = qm.valueToCode(ql, "ticks_nya", javascript.Order.ATOMIC);
  var qp = "risevsfall_noofticks[" + qn + "].value=" + qo + "*1;";
  return qp;
};
Blockly.defineBlocksWithJsonArray([{
  type: "risevsfall",
  message0: "Rise VS Fall: %1 %2",
  args0: [{
    type: "field_dropdown",
    name: "dropdown_risevsfall_A",
    options: [["Row#1", "1"], ["Row#2", "2"], ["Row#3", "3"], ["Row#4", "4"], ["Row#5", "5"], ["Row#6", "6"]]
  }, {
    type: "field_dropdown",
    name: "dropdown_risevsfall_B",
    options: [["Rise(%)", "rise"], ["Fall(%)", "fall"]]
  }],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.risevsfall = function (qq, qr) {
  var qs = qq.getFieldValue("dropdown_risevsfall_A");
  var qt = qq.getFieldValue("dropdown_risevsfall_B");
  var qu = "document.getElementById(\"risevsfall_" + qs + "_" + qt + "\").innerText.replaceAll(\"%\",\"\")*1";
  return [qu, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "inpTickTrismasetperiod",
  message0: "Triple SMA ticks | Set period %1 : %2",
  args0: [{
    type: "field_dropdown",
    name: "row_nya",
    options: [["SMA#1", "1"], ["SMA#2", "2"], ["SMA#3", "3"]]
  }, {
    type: "input_value",
    name: "period_nya"
  }],
  inputsInline: true,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.inpTickTrismasetperiod = function (qv, qw) {
  var qx = qv.getFieldValue("row_nya");
  var qy = qw.valueToCode(qv, "period_nya", javascript.Order.ATOMIC);
  var qz = "inpTickTrisma_period[" + qx + "].value=" + qy + "*1;";
  return qz;
};
Blockly.defineBlocksWithJsonArray([{
  type: "ticktrisma",
  message0: "Triple SMA ticks: %1 %2",
  args0: [{
    type: "field_dropdown",
    name: "dropdown_ticktrisma_A",
    options: [["SMA#1", "1"], ["SMA#2", "2"], ["SMA#3", "3"]]
  }, {
    type: "field_dropdown",
    name: "dropdown_ticktrisma_B",
    options: [["List", "list"], ["20th", "20"], ["19th", "19"], ["18th", "18"], ["17th", "17"], ["16th", "16"], ["15th", "15"], ["14th", "14"], ["13th", "13"], ["12th", "12"], ["11th", "11"], ["10th", "10"], ["9th", "9"], ["8th", "8"], ["7th", "7"], ["6th", "6"], ["5th", "5"], ["4th", "4"], ["3rd", "3"], ["2nd", "2"], ["1st", "1"]]
  }],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.ticktrisma = function (ra, rb) {
  var rc = ra.getFieldValue("dropdown_ticktrisma_A");
  var rd = ra.getFieldValue("dropdown_ticktrisma_B");
  var rf;
  if (rd == "list") {
    rf = "tick_sma_list[" + rc + "]";
  } else {
    rf = "document.getElementById(\"tick_sma" + rc + "_" + rd + "\").innerText*1";
  }
  return [rf, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "detail3ticks",
  message0: "Detail 3 ticks: %1 %2",
  args0: [{
    type: "field_dropdown",
    name: "dropdown_detail3ticks_A",
    options: [["1st last tick", "1"], ["2nd last tick", "2"], ["3rd last tick", "3"]]
  }, {
    type: "field_dropdown",
    name: "dropdown_detail3ticks_B",
    options: [["1st", "1"], ["2nd", "2"], ["3rd", "3"], ["4th", "4"], ["5th", "5"], ["6th", "6"], ["7th", "7"], ["8th", "8"], ["9th", "9"], ["10th", "10"], ["11th", "11"], ["12th", "12"]]
  }],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.detail3ticks = function (rg, rh) {
  var ri = rg.getFieldValue("dropdown_detail3ticks_A");
  var rj = rg.getFieldValue("dropdown_detail3ticks_B");
  var rk = "document.getElementById(\"detail3ticks_" + ri + "_" + rj + "\").innerText";
  if (!isNaN(document.getElementById("detail3ticks_" + ri + "_" + rj).innerText)) {
    rk += "*1";
  }
  return [rk, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "getstataccu",
  message0: "Stats do ACCUMULATOR %1 Mercado: %2 %3 Growth Rate % [1-5]: %4 Tick List : %5",
  args0: [{
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "market_nya",
    options: arrPopulatedMarketAccu
  }, {
    type: "input_end_row"
  }, {
    type: "input_value",
    name: "growthRate_nya"
  }, {
    type: "input_value",
    name: "arrTick_nya",
    check: "Array"
  }],
  inputsInline: false,
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.getstataccu = function (rl, rm) {
  var rn = rl.getFieldValue("market_nya");
  var ro = rn == "activemarket" ? "mainSymbol" : rn == "mainMarket_continuousindices" ? "mainMarket_continuousindices" : "\"" + rn.split("|")[0] + "\"";
  var rp = rm.valueToCode(rl, "growthRate_nya", javascript.Order.ATOMIC);
  var rq = rm.valueToCode(rl, "arrTick_nya", javascript.Order.ATOMIC);
  var rr = "getStatAccu(" + rq + "," + ro + "," + rp + ")";
  return [rr, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "datetime",
  message0: "Date/Time: %1",
  args0: [{
    type: "field_dropdown",
    name: "dropdown_datetime",
    options: [["Year", "year"], ["Month", "month"], ["Date", "date"], ["Hours", "hours"], ["Minutes", "minutes"], ["Seconds", "seconds"], ["Time Zone", "timezone"], ["Seconds Since Epoch", "secondssinceepoch"]]
  }],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.datetime = function (rs, ru) {
  var rv = rs.getFieldValue("dropdown_datetime");
  var rw;
  switch (rv) {
    case "year":
      rw = "new Date().getFullYear()";
      break;
    case "month":
      rw = "(new Date().getMonth())*1+1";
      break;
    case "date":
      rw = "new Date().getDate()";
      break;
    case "hours":
      rw = "new Date().getHours()";
      break;
    case "minutes":
      rw = "new Date().getMinutes()";
      break;
    case "seconds":
      rw = "new Date().getSeconds()";
      break;
    case "timezone":
      rw = "\"GMT\"+((new Date().getTimezoneOffset())==0 ? \"\" : ((new Date().getTimezoneOffset())<0 ? \"+\" : \"-\")+Math.abs(new Date().getTimezoneOffset()/60))";
      break;
    case "secondssinceepoch":
      rw = "Math.floor(new Date().getTime()/1000)";
      break;
  }
  return [rw, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "purchase_diff_match",
  message0: "Tipo de Contrato: %1 %2 Conta: %3 %4 Mercado: %5 %6 Stake %7 %8 Duração: ticks (1-10) %9 Previsão: (0-9) %10",
  args0: [{
    type: "field_dropdown",
    name: "selcontract_nya",
    options: [["Digit Differs", "DIGITDIFF"], ["Digit Matches", "DIGITMATCH"]]
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "account_nya",
    options: arrAccount
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "market_nya",
    options: arrPopulatedMarket2
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "stakeAM_nya",
    options: arrStakeAM
  }, {
    type: "input_value",
    name: "stake_nya"
  }, {
    type: "input_value",
    name: "inpduration_nya"
  }, {
    type: "input_value",
    name: "ldp_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.purchase_diff_match = function (rx, ry) {
  var rz = rx.getFieldValue("selcontract_nya");
  var sa = rx.getFieldValue("market_nya");
  var sb = sa == "activemarket" ? "mainSymbol" : sa == "mainMarket_continuousindices" ? "mainMarket_continuousindices" : "\"" + sa.split("|")[0] + "\"";
  var sc = rx.getFieldValue("account_nya");
  var sd = rx.getFieldValue("stakeAM_nya");
  var se = ry.valueToCode(rx, "stake_nya", javascript.Order.ATOMIC);
  if (se.toString().length == 0) {
    se = 1;
  }
  ;
  var sf = ry.valueToCode(rx, "inpduration_nya", javascript.Order.ATOMIC);
  var sg = ry.valueToCode(rx, "ldp_nya", javascript.Order.ATOMIC);
  var sh = "mainPurchase(\"" + sc + "\",\"" + sd + "\"," + se + ",\"" + rz + "\"," + sb + "," + sf + ",\"t\",0,0,0," + sg + ",0,0,0,0,0,0,0,0);";
  return sh;
};
Blockly.defineBlocksWithJsonArray([{
  type: "purchase_over_under",
  message0: "Tipo de Contrato: %1 %2 Conta: %3 %4 Mercado: %5 %6 Stake %7 %8 Duração: ticks (1-10) %9 Previsão: (Over:0-8) (Under:1-9) %10",
  args0: [{
    type: "field_dropdown",
    name: "selcontract_nya",
    options: [["Digit Over", "DIGITOVER"], ["Digit Under", "DIGITUNDER"]]
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "account_nya",
    options: arrAccount
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "market_nya",
    options: arrPopulatedMarket2
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "stakeAM_nya",
    options: arrStakeAM
  }, {
    type: "input_value",
    name: "stake_nya"
  }, {
    type: "input_value",
    name: "inpduration_nya"
  }, {
    type: "input_value",
    name: "ldp_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.purchase_over_under = function (si, sj) {
  var sk = si.getFieldValue("selcontract_nya");
  var sm = si.getFieldValue("market_nya");
  var sn = sm == "activemarket" ? "mainSymbol" : sm == "mainMarket_continuousindices" ? "mainMarket_continuousindices" : "\"" + sm.split("|")[0] + "\"";
  var so = si.getFieldValue("account_nya");
  var sp = si.getFieldValue("stakeAM_nya");
  var sq = sj.valueToCode(si, "stake_nya", javascript.Order.ATOMIC);
  if (sq.toString().length == 0) {
    sq = 1;
  }
  ;
  var sr = sj.valueToCode(si, "inpduration_nya", javascript.Order.ATOMIC);
  var ss = sj.valueToCode(si, "ldp_nya", javascript.Order.ATOMIC);
  var su = "mainPurchase(\"" + so + "\",\"" + sp + "\"," + sq + ",\"" + sk + "\"," + sn + "," + sr + ",\"t\",0,0,0,0," + ss + "," + ss + ",0,0,0,0,0,0);";
  return su;
};
Blockly.defineBlocksWithJsonArray([{
  type: "purchase_even_odd",
  message0: "Tipo de Contrato: %1 %2 Conta: %3 %4 Mercado: %5 %6 Stake %7 %8 Duração: ticks (1-10) %9",
  args0: [{
    type: "field_dropdown",
    name: "selcontract_nya",
    options: [["Digit Even", "DIGITEVEN"], ["Digit Odd", "DIGITODD"]]
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "account_nya",
    options: arrAccount
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "market_nya",
    options: arrPopulatedMarket2
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "stakeAM_nya",
    options: arrStakeAM
  }, {
    type: "input_value",
    name: "stake_nya"
  }, {
    type: "input_value",
    name: "inpduration_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.purchase_even_odd = function (sv, sw) {
  var sx = sv.getFieldValue("selcontract_nya");
  var sy = sv.getFieldValue("market_nya");
  var sz = sy == "activemarket" ? "mainSymbol" : sy == "mainMarket_continuousindices" ? "mainMarket_continuousindices" : "\"" + sy.split("|")[0] + "\"";
  var ta = sv.getFieldValue("account_nya");
  var tb = sv.getFieldValue("stakeAM_nya");
  var tc = sw.valueToCode(sv, "stake_nya", javascript.Order.ATOMIC);
  if (tc.toString().length == 0) {
    tc = 1;
  }
  ;
  var te = sw.valueToCode(sv, "inpduration_nya", javascript.Order.ATOMIC);
  var tf = "mainPurchase(\"" + ta + "\",\"" + tb + "\"," + tc + ",\"" + sx + "\"," + sz + "," + te + ",\"t\",0,0,0,0,0,0,0,0,0,0,0,0);";
  return tf;
};
Blockly.defineBlocksWithJsonArray([{
  type: "purchase_rise_fall",
  message0: "Tipo de Contrato: %1 %2 Conta: %3 %4 Mercado: %5 %6 Stake %7 %8 Duração: %9 %10",
  args0: [{
    type: "field_dropdown",
    name: "selcontract_nya",
    options: [["Rise", "CALL"], ["Fall", "PUT"], ["Rise (or Equals)", "CALLE"], ["Fall (or Equals)", "PUTE"]]
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "account_nya",
    options: arrAccount
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "market_nya",
    options: arrPopulatedMarket2
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "stakeAM_nya",
    options: arrStakeAM
  }, {
    type: "input_value",
    name: "stake_nya"
  }, {
    type: "field_dropdown",
    name: "seldurationunit_nya",
    options: [["tick(s)", "t"], ["second(s)", "s"], ["minute(s)", "m"], ["hour(s)", "h"], ["day(s)", "d"]]
  }, {
    type: "input_value",
    name: "inpduration_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.purchase_rise_fall = function (tg, ti) {
  var tj = tg.getFieldValue("selcontract_nya");
  var tk = tg.getFieldValue("market_nya");
  var tl = tk == "activemarket" ? "mainSymbol" : tk == "mainMarket_continuousindices" ? "mainMarket_continuousindices" : "\"" + tk.split("|")[0] + "\"";
  var tm = tg.getFieldValue("account_nya");
  var tn = tg.getFieldValue("stakeAM_nya");
  var tq = ti.valueToCode(tg, "stake_nya", javascript.Order.ATOMIC);
  if (tq.toString().length == 0) {
    tq = 1;
  }
  ;
  var tt = tg.getFieldValue("seldurationunit_nya");
  var tu = ti.valueToCode(tg, "inpduration_nya", javascript.Order.ATOMIC);
  var tv = "mainPurchase(\"" + tm + "\",\"" + tn + "\"," + tq + ",\"" + tj + "\"," + tl + "," + tu + ",\"" + tt + "\",\"+0\",0,0,0,0,0,0,0,0,0,0,0);";
  return tv;
};
Blockly.defineBlocksWithJsonArray([{
  type: "purchase_higher_lower",
  message0: "Tipo de Contrato: %1 %2 Conta: %3 %4 Mercado: %5 %6 Stake %7 %8 Duração: %9 %10 Barrier Offset: %11",
  args0: [{
    type: "field_dropdown",
    name: "selcontract_nya",
    options: [["Higher", "CALL"], ["Lower", "PUT"]]
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "account_nya",
    options: arrAccount
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "market_nya",
    options: arrPopulatedMarket2
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "stakeAM_nya",
    options: arrStakeAM
  }, {
    type: "input_value",
    name: "stake_nya"
  }, {
    type: "field_dropdown",
    name: "seldurationunit_nya",
    options: [["tick(s)", "t"], ["second(s)", "s"], ["minute(s)", "m"], ["hour(s)", "h"], ["day(s)", "d"]]
  }, {
    type: "input_value",
    name: "inpduration_nya"
  }, {
    type: "input_value",
    name: "barrier_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.purchase_higher_lower = function (tw, tx) {
  var ty = tw.getFieldValue("selcontract_nya");
  var tz = tw.getFieldValue("market_nya");
  var ua = tz == "activemarket" ? "mainSymbol" : tz == "mainMarket_continuousindices" ? "mainMarket_continuousindices" : "\"" + tz.split("|")[0] + "\"";
  var ub = tw.getFieldValue("account_nya");
  var uc = tw.getFieldValue("stakeAM_nya");
  var ud = tx.valueToCode(tw, "stake_nya", javascript.Order.ATOMIC);
  if (ud.toString().length == 0) {
    ud = 1;
  }
  ;
  var ue = tw.getFieldValue("seldurationunit_nya");
  var uf = tx.valueToCode(tw, "inpduration_nya", javascript.Order.ATOMIC);
  var ug = tx.valueToCode(tw, "barrier_nya", javascript.Order.ATOMIC);
  var uh = "mainPurchase(\"" + ub + "\",\"" + uc + "\"," + ud + ",\"" + ty + "\"," + ua + "," + uf + ",\"" + ue + "\"," + ug + ",0,0,0,0,0,0,0,0,0,0,0);";
  return uh;
};
Blockly.defineBlocksWithJsonArray([{
  type: "purchase_touch_notouch",
  message0: "Tipo de Contrato: %1 %2 Conta: %3 %4 Mercado: %5 %6 Stake %7 %8 Duração: %9 %10 Barrier Offset: %11",
  args0: [{
    type: "field_dropdown",
    name: "selcontract_nya",
    options: [["Touches", "ONETOUCH"], ["Does Not Touch", "NOTOUCH"]]
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "account_nya",
    options: arrAccount
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "market_nya",
    options: arrPopulatedMarket2
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "stakeAM_nya",
    options: arrStakeAM
  }, {
    type: "input_value",
    name: "stake_nya"
  }, {
    type: "field_dropdown",
    name: "seldurationunit_nya",
    options: [["tick(s)", "t"], ["second(s)", "s"], ["minute(s)", "m"], ["hour(s)", "h"], ["day(s)", "d"]]
  }, {
    type: "input_value",
    name: "inpduration_nya"
  }, {
    type: "input_value",
    name: "barrier_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.purchase_touch_notouch = function (ui, uj) {
  var ul = ui.getFieldValue("selcontract_nya");
  var um = ui.getFieldValue("market_nya");
  var un = um == "activemarket" ? "mainSymbol" : um == "mainMarket_continuousindices" ? "mainMarket_continuousindices" : "\"" + um.split("|")[0] + "\"";
  var uq = ui.getFieldValue("account_nya");
  var ur = ui.getFieldValue("stakeAM_nya");
  var ut = uj.valueToCode(ui, "stake_nya", javascript.Order.ATOMIC);
  if (ut.toString().length == 0) {
    ut = 1;
  }
  ;
  var uu = ui.getFieldValue("seldurationunit_nya");
  var uv = uj.valueToCode(ui, "inpduration_nya", javascript.Order.ATOMIC);
  var uw = uj.valueToCode(ui, "barrier_nya", javascript.Order.ATOMIC);
  var ux = "mainPurchase(\"" + uq + "\",\"" + ur + "\"," + ut + ",\"" + ul + "\"," + un + "," + uv + ",\"" + uu + "\"," + uw + ",0,0,0,0,0,0,0,0,0,0,0);";
  return ux;
};
Blockly.defineBlocksWithJsonArray([{
  type: "purchase_endsbetween_endsoutside",
  message0: "Tipo de Contrato: %1 %2 Conta: %3 %4 Mercado: %5 %6 Stake %7 %8 Duração: %9 %10 High Barrier Offset: %11 Low Barrier Offset: %12",
  args0: [{
    type: "field_dropdown",
    name: "selcontract_nya",
    options: [["Ends Between", "EXPIRYRANGE"], ["Ends Outside", "EXPIRYMISS"]]
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "account_nya",
    options: arrAccount
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "market_nya",
    options: arrPopulatedMarket2
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "stakeAM_nya",
    options: arrStakeAM
  }, {
    type: "input_value",
    name: "stake_nya"
  }, {
    type: "field_dropdown",
    name: "seldurationunit_nya",
    options: [["minute(s)", "m"], ["hour(s)", "h"], ["day(s)", "d"]]
  }, {
    type: "input_value",
    name: "inpduration_nya"
  }, {
    type: "input_value",
    name: "highbarrier_nya"
  }, {
    type: "input_value",
    name: "lowbarrier_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.purchase_endsbetween_endsoutside = function (uy, uz) {
  var va = uy.getFieldValue("selcontract_nya");
  var vb = uy.getFieldValue("market_nya");
  var vc = vb == "activemarket" ? "mainSymbol" : vb == "mainMarket_continuousindices" ? "mainMarket_continuousindices" : "\"" + vb.split("|")[0] + "\"";
  var vd = uy.getFieldValue("account_nya");
  var ve = uy.getFieldValue("stakeAM_nya");
  var vf = uz.valueToCode(uy, "stake_nya", javascript.Order.ATOMIC);
  if (vf.toString().length == 0) {
    vf = 1;
  }
  ;
  var vg = uy.getFieldValue("seldurationunit_nya");
  var vh = uz.valueToCode(uy, "inpduration_nya", javascript.Order.ATOMIC);
  var vi = uz.valueToCode(uy, "highbarrier_nya", javascript.Order.ATOMIC);
  var vj = uz.valueToCode(uy, "lowbarrier_nya", javascript.Order.ATOMIC);
  var vk = "mainPurchase(\"" + vd + "\",\"" + ve + "\"," + vf + ",\"" + va + "\"," + vc + "," + vh + ",\"" + vg + "\",0," + vi + "," + vj + ",0,0,0,0,0,0,0,0,0);";
  return vk;
};
Blockly.defineBlocksWithJsonArray([{
  type: "purchase_staysbetween_goesoutside",
  message0: "Tipo de Contrato: %1 %2 Conta: %3 %4 Mercado: %5 %6 Stake %7 %8 Duração: %9 %10 High Barrier Offset: %11 Low Barrier Offset: %12",
  args0: [{
    type: "field_dropdown",
    name: "selcontract_nya",
    options: [["Stays Between", "RANGE"], ["Goes Outside", "UPORDOWN"]]
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "account_nya",
    options: arrAccount
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "market_nya",
    options: arrPopulatedMarket2
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "stakeAM_nya",
    options: arrStakeAM
  }, {
    type: "input_value",
    name: "stake_nya"
  }, {
    type: "field_dropdown",
    name: "seldurationunit_nya",
    options: [["minute(s)", "m"], ["hour(s)", "h"], ["day(s)", "d"]]
  }, {
    type: "input_value",
    name: "inpduration_nya"
  }, {
    type: "input_value",
    name: "highbarrier_nya"
  }, {
    type: "input_value",
    name: "lowbarrier_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.purchase_staysbetween_goesoutside = function (vl, vm) {
  var vn = vl.getFieldValue("selcontract_nya");
  var vo = vl.getFieldValue("market_nya");
  var vp = vo == "activemarket" ? "mainSymbol" : vo == "mainMarket_continuousindices" ? "mainMarket_continuousindices" : "\"" + vo.split("|")[0] + "\"";
  var vq = vl.getFieldValue("account_nya");
  var vr = vl.getFieldValue("stakeAM_nya");
  var vt = vm.valueToCode(vl, "stake_nya", javascript.Order.ATOMIC);
  if (vt.toString().length == 0) {
    vt = 1;
  }
  ;
  var vu = vl.getFieldValue("seldurationunit_nya");
  var vv = vm.valueToCode(vl, "inpduration_nya", javascript.Order.ATOMIC);
  var vw = vm.valueToCode(vl, "highbarrier_nya", javascript.Order.ATOMIC);
  var vx = vm.valueToCode(vl, "lowbarrier_nya", javascript.Order.ATOMIC);
  var vy = "mainPurchase(\"" + vq + "\",\"" + vr + "\"," + vt + ",\"" + vn + "\"," + vp + "," + vv + ",\"" + vu + "\",0," + vw + "," + vx + ",0,0,0,0,0,0,0,0,0);";
  return vy;
};
Blockly.defineBlocksWithJsonArray([{
  type: "purchase_asianup_asiandown",
  message0: "Tipo de Contrato: %1 %2 Conta: %3 %4 Market: %5 %6 Stake %7 %8 Duration: ticks [5-10] %9",
  args0: [{
    type: "field_dropdown",
    name: "selcontract_nya",
    options: [["Asian Up", "ASIANU"], ["Asian Down", "ASIAND"]]
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "account_nya",
    options: arrAccount
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "market_nya",
    options: arrPopulatedMarket2
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "stakeAM_nya",
    options: arrStakeAM
  }, {
    type: "input_value",
    name: "stake_nya"
  }, {
    type: "input_value",
    name: "inpduration_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.purchase_asianup_asiandown = function (vz, wb) {
  var wc = vz.getFieldValue("selcontract_nya");
  var wd = vz.getFieldValue("market_nya");
  var we = wd == "activemarket" ? "mainSymbol" : wd == "mainMarket_continuousindices" ? "mainMarket_continuousindices" : "\"" + wd.split("|")[0] + "\"";
  var wf = vz.getFieldValue("account_nya");
  var wg = vz.getFieldValue("stakeAM_nya");
  var wh = wb.valueToCode(vz, "stake_nya", javascript.Order.ATOMIC);
  if (wh.toString().length == 0) {
    wh = 1;
  }
  ;
  var wi = wb.valueToCode(vz, "inpduration_nya", javascript.Order.ATOMIC);
  var wj = "mainPurchase(\"" + wf + "\",\"" + wg + "\"," + wh + ",\"" + wc + "\"," + we + "," + wi + ",\"t\",0,0,0,0,0,0,0,0,0,0,0,0);";
  return wj;
};
Blockly.defineBlocksWithJsonArray([{
  type: "purchase_highclose_closelow_highlow",
  message0: "Tipo de Contrato: %1 %2 Conta: %3 %4 Market: %5 %6 Stake %7 %8 Duration: minutes [1-30] %9 Multiplier: %10",
  args0: [{
    type: "field_dropdown",
    name: "selcontract_nya",
    options: [["High-Close", "LBFLOATPUT"], ["Close-Low", "LBFLOATCALL"], ["High-Low", "LBHIGHLOW"]]
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "account_nya",
    options: arrAccount
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "market_nya",
    options: arrPopulatedMarket2
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "stakeAM_nya",
    options: arrStakeAM
  }, {
    type: "input_value",
    name: "stake_nya"
  }, {
    type: "input_value",
    name: "inpduration_nya"
  }, {
    type: "input_value",
    name: "multiplier_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.purchase_highclose_closelow_highlow = function (wk, wl) {
  var wm = wk.getFieldValue("selcontract_nya");
  var wn = wk.getFieldValue("market_nya");
  var wo = wn == "activemarket" ? "mainSymbol" : wn == "mainMarket_continuousindices" ? "mainMarket_continuousindices" : "\"" + wn.split("|")[0] + "\"";
  var wp = wk.getFieldValue("account_nya");
  var wq = wk.getFieldValue("stakeAM_nya");
  var wt = wl.valueToCode(wk, "stake_nya", javascript.Order.ATOMIC);
  if (wt.toString().length == 0) {
    wt = 1;
  }
  ;
  var wu = wl.valueToCode(wk, "inpduration_nya", javascript.Order.ATOMIC);
  var wv = wl.valueToCode(wk, "multiplier_nya", javascript.Order.ATOMIC);
  var ww = "mainPurchase(\"" + wp + "\",\"" + wq + "\"," + wt + ",\"" + wm + "\"," + wo + "," + wu + ",\"m\",0,0,0,0,0,0," + wv + ",0,0,0,0,0);";
  return ww;
};
Blockly.defineBlocksWithJsonArray([{
  type: "purchase_resetcall_resetput",
  message0: "Tipo de Contrato: %1 %2 Conta: %3 %4 Market: %5 %6 Stake %7 %8 Duration: %9 %10",
  args0: [{
    type: "field_dropdown",
    name: "selcontract_nya",
    options: [["Reset Call", "RESETCALL"], ["Reset Put", "RESETPUT"]]
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "account_nya",
    options: arrAccount
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "market_nya",
    options: arrPopulatedMarket2
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "stakeAM_nya",
    options: arrStakeAM
  }, {
    type: "input_value",
    name: "stake_nya"
  }, {
    type: "field_dropdown",
    name: "seldurationunit_nya",
    options: [["tick(s)", "t"], ["second(s)", "s"], ["minute(s)", "m"], ["hour(s)", "h"]]
  }, {
    type: "input_value",
    name: "inpduration_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.purchase_resetcall_resetput = function (wx, wy) {
  var wz = wx.getFieldValue("selcontract_nya");
  var xa = wx.getFieldValue("market_nya");
  var xb = xa == "activemarket" ? "mainSymbol" : xa == "mainMarket_continuousindices" ? "mainMarket_continuousindices" : "\"" + xa.split("|")[0] + "\"";
  var xc = wx.getFieldValue("account_nya");
  var xd = wx.getFieldValue("stakeAM_nya");
  var xe = wy.valueToCode(wx, "stake_nya", javascript.Order.ATOMIC);
  if (xe.toString().length == 0) {
    xe = 1;
  }
  ;
  var xf = wx.getFieldValue("seldurationunit_nya");
  var xg = wy.valueToCode(wx, "inpduration_nya", javascript.Order.ATOMIC);
  var xh = "mainPurchase(\"" + xc + "\",\"" + xd + "\"," + xe + ",\"" + wz + "\"," + xb + "," + xg + ",\"" + xf + "\",0,0,0,0,0,0,0,0,0,0,0,0);";
  return xh;
};
Blockly.defineBlocksWithJsonArray([{
  type: "purchase_hightick_lowtick",
  message0: "Tipo de Contrato: %1 %2 Conta: %3 %4 Market: %5 %6 Stake %7 %8 Duration: 5 Ticks %9 Tick Prediction: [1-5] %10",
  args0: [{
    type: "field_dropdown",
    name: "selcontract_nya",
    options: [["High Tick", "TICKHIGH"], ["Low Tick", "TICKLOW"]]
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "account_nya",
    options: arrAccount
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "market_nya",
    options: arrPopulatedMarket2
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "stakeAM_nya",
    options: arrStakeAM
  }, {
    type: "input_value",
    name: "stake_nya"
  }, {
    type: "input_end_row"
  }, {
    type: "input_value",
    name: "tickprediction_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.purchase_hightick_lowtick = function (xi, xj) {
  var xk = xi.getFieldValue("selcontract_nya");
  var xl = xi.getFieldValue("market_nya");
  var xm = xl == "activemarket" ? "mainSymbol" : xl == "mainMarket_continuousindices" ? "mainMarket_continuousindices" : "\"" + xl.split("|")[0] + "\"";
  var xn = xi.getFieldValue("account_nya");
  var xo = xi.getFieldValue("stakeAM_nya");
  var xp = xj.valueToCode(xi, "stake_nya", javascript.Order.ATOMIC);
  if (xp.toString().length == 0) {
    xp = 1;
  }
  ;
  var xq = xj.valueToCode(xi, "tickprediction_nya", javascript.Order.ATOMIC);
  var xr = "mainPurchase(\"" + xn + "\",\"" + xo + "\"," + xp + ",\"" + xk + "\"," + xm + ",5,\"t\",0,0,0,0,0,0,0," + xq + ",0,0,0,0);";
  return xr;
};
Blockly.defineBlocksWithJsonArray([{
  type: "purchase_onlyups_onlydowns",
  message0: "Tipo de Contrato: %1 %2 Conta: %3 %4 Market: %5 %6 Stake %7 %8 Duration: ticks [2-5] %9",
  args0: [{
    type: "field_dropdown",
    name: "selcontract_nya",
    options: [["Only Ups", "RUNHIGH"], ["Only Downs", "RUNLOW"]]
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "account_nya",
    options: arrAccount
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "market_nya",
    options: arrPopulatedMarket2
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "stakeAM_nya",
    options: arrStakeAM
  }, {
    type: "input_value",
    name: "stake_nya"
  }, {
    type: "input_value",
    name: "inpduration_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.purchase_onlyups_onlydowns = function (xs, xt) {
  var xu = xs.getFieldValue("selcontract_nya");
  var xv = xs.getFieldValue("market_nya");
  var xw = xv == "activemarket" ? "mainSymbol" : xv == "mainMarket_continuousindices" ? "mainMarket_continuousindices" : "\"" + xv.split("|")[0] + "\"";
  var xx = xs.getFieldValue("account_nya");
  var xy = xs.getFieldValue("stakeAM_nya");
  var xz = xt.valueToCode(xs, "stake_nya", javascript.Order.ATOMIC);
  if (xz.toString().length == 0) {
    xz = 1;
  }
  ;
  var ya = xt.valueToCode(xs, "inpduration_nya", javascript.Order.ATOMIC);
  var yb = "mainPurchase(\"" + xx + "\",\"" + xy + "\"," + xz + ",\"" + xu + "\"," + xw + "," + ya + ",\"t\",0,0,0,0,0,0,0,0,0,0,0,0);";
  return yb;
};
Blockly.defineBlocksWithJsonArray([{
  type: "purchase_accumulatorup",
  message0: "Tipo de Contrato: %1 %2 Conta: %3 %4 Market: %5 %6 Stake %7 %8 Growth Rate % [1-5]: %9 Take Profit: %10",
  args0: [{
    type: "field_dropdown",
    name: "selcontract_nya",
    options: [["Accumulator Up", "ACCU"]]
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "account_nya",
    options: arrAccount
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "market_nya",
    options: arrPopulatedMarket2
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "stakeAM_nya",
    options: arrStakeAM
  }, {
    type: "input_value",
    name: "stake_nya"
  }, {
    type: "input_value",
    name: "selaccumulate_nya"
  }, {
    type: "input_value",
    name: "limittp_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.purchase_accumulatorup = function (yc, yd) {
  var ye = yc.getFieldValue("selcontract_nya");
  var yf = yc.getFieldValue("market_nya");
  var yg = yf == "activemarket" ? "mainSymbol" : yf == "mainMarket_continuousindices" ? "mainMarket_continuousindices" : "\"" + yf.split("|")[0] + "\"";
  var yh = yc.getFieldValue("account_nya");
  var yi = yc.getFieldValue("stakeAM_nya");
  var yj = yd.valueToCode(yc, "stake_nya", javascript.Order.ATOMIC);
  if (yj.toString().length == 0) {
    yj = 1;
  }
  ;
  var yk = yd.valueToCode(yc, "selaccumulate_nya", javascript.Order.ATOMIC);
  var yl = yd.valueToCode(yc, "limittp_nya", javascript.Order.ATOMIC);
  var ym = "mainPurchase(\"" + yh + "\",\"" + yi + "\"," + yj + ",\"" + ye + "\"," + yg + ",100,\"t\",0,0,0,0,0,0,0,0," + yk + ",0," + yl + ",0);";
  return ym;
};
Blockly.defineBlocksWithJsonArray([{
  type: "purchase_multiplyup_multiplydown",
  message0: "Tipo de Contrato: %1 %2 Conta: %3 %4 Market: %5 %6 Stake %7 %8 %9 Multiplier: %10 Take Profit: %11 Stop Loss: %12",
  args0: [
    {
      type: "field_dropdown",
      name: "selcontract_nya",
      options: [["Multiply Up", "MULTUP"], ["Multiply Down", "MULTDOWN"]]
    }, {
      type: "input_end_row"
    }, {
      type: "field_dropdown",
      name: "account_nya",
      options: arrAccount
    }, {
      type: "input_end_row"
    }, {
      type: "field_dropdown",
      name: "market_nya",
      options: arrPopulatedMarket2
    }, {
      type: "input_end_row"
    }, {
      type: "field_dropdown",
      name: "stakeAM_nya",
      options: arrStakeAM
    }, {
      type: "input_value",
      name: "stake_nya"
    }, {
      type: "input_end_row"
    },
    {
      type: "input_value", // Alterado de field_dropdown para input_value
      name: "selmultipliermultiply_nya",
      //check: "Number" // Valida como número
    }, {
      type: "input_value",
      name: "limittp_nya"
    }, {
      type: "input_value",
      name: "limitsl_nya"
    }
  ],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);

javascript.javascriptGenerator.forBlock.purchase_multiplyup_multiplydown = function (yn, yo) {
  var yp = yn.getFieldValue("selcontract_nya");
  var yq = yn.getFieldValue("market_nya");
  var yr = yq == "activemarket" ? "mainSymbol" : yq == "mainMarket_continuousindices" ? "mainMarket_continuousindices" : "\"" + yq.split("|")[0] + "\"";
  var ys = yn.getFieldValue("account_nya");
  var yt = yn.getFieldValue("stakeAM_nya");
  var yu = yo.valueToCode(yn, "stake_nya", javascript.Order.ATOMIC);
  if (yu.toString().length == 0) {
    yu = 1;
  }
  ;
  var yv = yo.valueToCode(yn, "selmultipliermultiply_nya", javascript.Order.ATOMIC);
  var yw = yo.valueToCode(yn, "limittp_nya", javascript.Order.ATOMIC);
  var yx = yo.valueToCode(yn, "limitsl_nya", javascript.Order.ATOMIC);
  var yy = "mainPurchase(\"" + ys + "\",\"" + yt + "\"," + yu + ",\"" + yp + "\"," + yr + ",0,\"t\",0,0,0,0,0,0,0,0,0,\"" + yv + "\"," + yw + "," + yx + ");";
  return yy;
};
Blockly.defineBlocksWithJsonArray([{
  type: "purchase_vanillalongcall_vanillalongput",
  message0: "Tipo de Contrato: %1 %2 Conta: %3 %4 Market: %5 %6 Stake %7 %8 Duration: %9 %10 Barrier Offset: %11",
  args0: [{
    type: "field_dropdown",
    name: "selcontract_nya",
    options: [["Vanilla Long Call", "VANILLALONGCALL"], ["Vanilla Long Put", "VANILLALONGPUT"]]
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "account_nya",
    options: arrAccount
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "market_nya",
    options: arrPopulatedMarket2
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "stakeAM_nya",
    options: arrStakeAM
  }, {
    type: "input_value",
    name: "stake_nya"
  }, {
    type: "field_dropdown",
    name: "seldurationunit_nya",
    options: [["minute(s)", "m"], ["hour(s)", "h"], ["day(s)", "d"]]
  }, {
    type: "input_value",
    name: "inpduration_nya"
  }, {
    type: "input_value",
    name: "barrier_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.purchase_vanillalongcall_vanillalongput = function (yz, za) {
  var zb = yz.getFieldValue("selcontract_nya");
  var zc = yz.getFieldValue("market_nya");
  var zd = zc == "activemarket" ? "mainSymbol" : zc == "mainMarket_continuousindices" ? "mainMarket_continuousindices" : "\"" + zc.split("|")[0] + "\"";
  var ze = yz.getFieldValue("account_nya");
  var zf = yz.getFieldValue("stakeAM_nya");
  var zg = za.valueToCode(yz, "stake_nya", javascript.Order.ATOMIC);
  if (zg.toString().length == 0) {
    zg = 1;
  }
  ;
  var zh = yz.getFieldValue("seldurationunit_nya");
  var zi = za.valueToCode(yz, "inpduration_nya", javascript.Order.ATOMIC);
  var zj = za.valueToCode(yz, "barrier_nya", javascript.Order.ATOMIC);
  var zk = "mainPurchase(\"" + ze + "\",\"" + zf + "\"," + zg + ",\"" + zb + "\"," + zd + "," + zi + ",\"" + zh + "\"," + zj + ",0,0,0,0,0,0,0,0,0,0,0);";
  return zk;
};
Blockly.defineBlocksWithJsonArray([{
  type: "purchase_turboslong_turbosshort",
  message0: "Tipo de Contrato: %1 %2 Conta: %3 %4 Market: %5 %6 Stake %7 %8 Duration: %9 %10 Barrier Offset: %11",
  args0: [{
    type: "field_dropdown",
    name: "selcontract_nya",
    options: [["Turbos Long", "TURBOSLONG"], ["Turbos Short", "TURBOSSHORT"]]
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "account_nya",
    options: arrAccount
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "market_nya",
    options: arrPopulatedMarket2
  }, {
    type: "input_end_row"
  }, {
    type: "field_dropdown",
    name: "stakeAM_nya",
    options: arrStakeAM
  }, {
    type: "input_value",
    name: "stake_nya"
  }, {
    type: "field_dropdown",
    name: "seldurationunit_nya",
    options: [["tick(s)", "t"], ["second(s)", "s"], ["minute(s)", "m"], ["hour(s)", "h"], ["day(s)", "d"]]
  }, {
    type: "input_value",
    name: "inpduration_nya"
  }, {
    type: "input_value",
    name: "barrier_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.purchase_turboslong_turbosshort = function (zl, zm) {
  var zn = zl.getFieldValue("selcontract_nya");
  var zo = zl.getFieldValue("market_nya");
  var zp = zo == "activemarket" ? "mainSymbol" : zo == "mainMarket_continuousindices" ? "mainMarket_continuousindices" : "\"" + zo.split("|")[0] + "\"";
  var zq = zl.getFieldValue("account_nya");
  var zr = zl.getFieldValue("stakeAM_nya");
  var zs = zm.valueToCode(zl, "stake_nya", javascript.Order.ATOMIC);
  if (zs.toString().length == 0) {
    zs = 1;
  }
  ;
  var zt = zl.getFieldValue("seldurationunit_nya");
  var zu = zm.valueToCode(zl, "inpduration_nya", javascript.Order.ATOMIC);
  var zv = zm.valueToCode(zl, "barrier_nya", javascript.Order.ATOMIC);
  var zw = "mainPurchase(\"" + zq + "\",\"" + zr + "\"," + zs + ",\"" + zn + "\"," + zp + "," + zu + ",\"" + zt + "\"," + zv + ",0,0,0,0,0,0,0,0,0,0,0);";
  return zw;
};
Blockly.defineBlocksWithJsonArray([{
  type: "write_log",
  message0: "Notify %1 Sound: %2 %3",
  args0: [{
    type: "field_dropdown",
    name: "color_nya",
    options: [["Sem Cor", ""], ["Azul Claro", "42a5f5"], ["Azul Escuro", "25238c"], ["Vermelho Claro", "f44336"], ["Vermelho Escuro", "7d231d"], ["Verde Claro", "04AA6D"], ["Verde Escuro", "023d28"], ["Amarelo Claro", "ffbf00"], ["Amarelo Escuro", "8a6907"], ["Roxo Claro", "6404b3"], ["Roxo Escuro", "310357"]]
  }, {
    type: "field_dropdown",
    name: "sound_nya",
    options: [["Silent", "silent"], ["Announcement", "announcement"], ["Earned money", "earned-money"], ["Job done", "job-done"], ["Error", "error"], ["Severe error", "severe-error"]]
  }, {
    type: "input_value",
    name: "log_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.write_log = function (zx, zy) {
  var zz = zy.valueToCode(zx, "log_nya", javascript.Order.ATOMIC);
  var aaa = zx.getFieldValue("color_nya");
  var aab = zx.getFieldValue("sound_nya");
  var aac;
  if (aab == "silent") {
    aac = "";
  } else {
    aac = "document.getElementById(\"" + aab + "\").play();";
  }
  aac += "writeLog(\"#" + aaa + "\"," + zz + ");";
  return aac;
};
let arrPopulatedMarket = [["Continuous Indices:Volatility 10 (1s) Index", "1HZ10V|Volatility 10 (1s) Index"], ["Continuous Indices:Volatility 10 Index", "R_10|Volatility 10 Index"], ["Continuous Indices:Volatility 25 (1s) Index", "1HZ25V|Volatility 25 (1s) Index"], ["Continuous Indices:Volatility 25 Index", "R_25|Volatility 25 Index"], ["Continuous Indices:Volatility 50 (1s) Index", "1HZ50V|Volatility 50 (1s) Index"], ["Continuous Indices:Volatility 50 Index", "R_50|Volatility 50 Index"], ["Continuous Indices:Volatility 75 (1s) Index", "1HZ75V|Volatility 75 (1s) Index"], ["Continuous Indices:Volatility 75 Index", "R_75|Volatility 75 Index"], ["Continuous Indices:Volatility 100 (1s) Index", "1HZ100V|Volatility 100 (1s) Index"], ["Continuous Indices:Volatility 100 Index", "R_100|Volatility 100 Index"], ["Continuous Indices:Volatility 150 (1s) Index", "1HZ150V|Volatility 150 (1s) Index"], ["Continuous Indices:Volatility 250 (1s) Index", "1HZ250V|Volatility 250 (1s) Index"], ["Daily Reset Indices:Bear Market Index", "RDBEAR|Bear Market Index"], ["Daily Reset Indices:Bull Market Index", "RDBULL|Bull Market Index"], ["Jump Indices:Jump 10 Index", "JD10|Jump 10 Index"], ["Jump Indices:Jump 25 Index", "JD25|Jump 25 Index"], ["Jump Indices:Jump 50 Index", "JD50|Jump 50 Index"], ["Jump Indices:Jump 75 Index", "JD75|Jump 75 Index"], ["Jump Indices:Jump 100 Index", "JD100|Jump 100 Index"], ["Step Indices:Step Index", "stpRNG|Step Index"], ["Crash/Boom Indices:Crash 300 Index", "CRASH300N|Crash 300 Index"], ["Crash/Boom Indices:Crash 500 Index", "CRASH500|Crash 500 Index"], ["Crash/Boom Indices:Crash 1000 Index", "CRASH1000|Crash 1000 Index"], ["Crash/Boom Indices:Boom 300 Index", "BOOM300N|Boom 300 Index"], ["Crash/Boom Indices:Boom 500 Index", "BOOM500|Boom 500 Index"], ["Crash/Boom Indices:Boom 1000 Index", "BOOM1000|Boom 1000 Index"], ["Major Pairs:AUD/JPY", "frxAUDJPY|AUD/JPY"], ["Major Pairs:AUD/USD", "frxAUDUSD|AUD/USD"], ["Major Pairs:EUR/AUD", "frxEURAUD|EUR/AUD"], ["Major Pairs:EUR/CHF", "frxEURCHF|EUR/CHF"], ["Major Pairs:EUR/GBP", "frxEURGBP|EUR/GBP"], ["Major Pairs:EUR/JPY", "frxEURJPY|EUR/JPY"], ["Major Pairs:EUR/USD", "frxEURUSD|EUR/USD"], ["Major Pairs:GBP/AUD", "frxGBPAUD|GBP/AUD"], ["Major Pairs:GBP/JPY", "frxGBPJPY|GBP/JPY"], ["Major Pairs:GBP/USD", "frxGBPUSD|GBP/USD"], ["Major Pairs:USD/CAD", "frxUSDCAD|USD/CAD"], ["Major Pairs:USD/CHF", "frxUSDCHF|USD/CHF"], ["Major Pairs:USD/JPY", "frxUSDJPY|USD/JPY"], ["Minor Pairs:AUD/CAD", "frxAUDCAD|AUD/CAD"], ["Minor Pairs:AUD/CHF", "frxAUDCHF|AUD/CHF"], ["Minor Pairs:AUD/NZD", "frxAUDNZD|AUD/NZD"], ["Minor Pairs:EUR/NZD", "frxEURNZD|EUR/NZD"], ["Minor Pairs:GBP/CAD", "frxGBPCAD|GBP/CAD"], ["Minor Pairs:GBP/CHF", "frxGBPCHF|GBP/CHF"], ["Minor Pairs:GBP/NOK", "frxGBPNOK|GBP/NOK"], ["Minor Pairs:GBP/NZD", "frxGBPNZD|GBP/NZD"], ["Minor Pairs:NZD/JPY", "frxNZDJPY|NZD/JPY"], ["Minor Pairs:NZD/USD", "frxNZDUSD|NZD/USD"], ["Minor Pairs:USD/MXN", "frxUSDMXN|USD/MXN"], ["Minor Pairs:USD/NOK", "frxUSDNOK|USD/NOK"], ["Minor Pairs:USD/PLN", "frxUSDPLN|USD/PLN"], ["Minor Pairs:USD/SEK", "frxUSDSEK|USD/SEK"], ["Asian indices:Australia 200", "OTC_AS51|Australia 200"], ["Asian indices:Hong Kong 50", "OTC_HSI|Hong Kong 50"], ["Asian indices:Japan 225", "OTC_N225|Japan 225"], ["European indices:Euro 50", "OTC_SX5E|Euro 50"], ["European indices:France 40", "OTC_FCHI|France 40"], ["European indices:Germany 40", "OTC_GDAXI|Germany 40"], ["European indices:Netherlands 25", "OTC_AEX|Netherlands 25"], ["European indices:Swiss 20", "OTC_SSMI|Swiss 20"], ["European indices:UK 100", "OTC_FTSE|UK 100"], ["American indices:US 500", "OTC_SPC|US 500"], ["American indices:US Tech 100", "OTC_NDX|US Tech 100"], ["American indices:Wall Street 30", "OTC_DJI|Wall Street 30"], ["Forex Basket:AUD Basket", "WLDAUD|AUD Basket"], ["Forex Basket:EUR Basket", "WLDEUR|EUR Basket"], ["Forex Basket:GBP Basket", "WLDGBP|GBP Basket"], ["Forex Basket:USD Basket", "WLDUSD|USD Basket"], ["Commodities Basket:Gold Basket", "WLDXAU|Gold Basket"], ["Metals:Gold/USD", "frxXAUUSD|Gold/USD"], ["Metals:Palladium/USD", "frxXPDUSD|Palladium/USD"], ["Metals:Platinum/USD", "frxXPTUSD|Platinum/USD"], ["Metals:Silver/USD", "frxXAGUSD|Silver/USD"], ["Cryptocurrencies:BTC/USD", "cryBTCUSD|BTC/USD"], ["Cryptocurrencies:ETH/USD", "cryETHUSD|ETH/USD"]];
Blockly.defineBlocksWithJsonArray([{
  type: "setmarket",
  message0: "Ativar o Mercado: %1",
  args0: [{
    type: "field_dropdown",
    name: "market_nya",
    options: arrPopulatedMarket
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.setmarket = function (aad, aae) {
  var aaf = aad.getFieldValue("market_nya");
  var aag = "if(mainSymbol!=\"" + aaf.split("|")[0] + "\"){mainSymbol=\"" + aaf.split("|")[0] + "\";document.getElementById(\"lblMarket\").innerText=\"" + aaf.split("|")[1] + "\";forgetAllTicks();};";
  return aag;
};
Blockly.defineBlocksWithJsonArray([{
  type: "setmoneymanagementtosmartmartingale",
  message0: "Definir Gerenciamento: Martingale Inteligente %1 Voltar ao Stake Inicial SOMENTE após cobrir a perda anterior: %2 %3 Stake Inicial: %4 Fator Martingale: %5",
  args0: [{
    type: "input_end_row"
  }, {
    type: "field_checkbox",
    name: "check_smart_nya",
    checked: true
  }, {
    type: "input_end_row"
  }, {
    type: "input_value",
    name: "initialstake_nya"
  }, {
    type: "input_value",
    name: "martingalefactor_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.setmoneymanagementtosmartmartingale = function (aah, aai) {
  var aaj = aah.getFieldValue("check_smart_nya") === "TRUE";
  var aak = aai.valueToCode(aah, "initialstake_nya", javascript.Order.ATOMIC);
  var aal = aai.valueToCode(aah, "martingalefactor_nya", javascript.Order.ATOMIC);
  var aam = "selMoneyManagement.value=\"smartmartingale\";inpInitStake.value=" + aak + ";inpMartiFactor.value=" + aal + ";chkSmart.checked=" + aaj + ";selMoneyManagementChanged();";
  return aam;
};
Blockly.defineBlocksWithJsonArray([{
  type: "setmoneymanagementtosmartcyclestake",
  message0: "Definir Gerenciamento: Ciclo de Stake %1 Voltar ao Stake Inicial SOMENTE após cobrir a perda anterior: %2 %3 Ciclo de Stake: %4",
  args0: [{
    type: "input_end_row"
  }, {
    type: "field_checkbox",
    name: "check_smart_nya",
    checked: true
  }, {
    type: "input_end_row"
  }, {
    type: "input_value",
    name: "cyclestake_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.setmoneymanagementtosmartcyclestake = function (aan, aao) {
  var aap = aan.getFieldValue("check_smart_nya") === "TRUE";
  var aaq = aao.valueToCode(aan, "cyclestake_nya", javascript.Order.ATOMIC);
  var aar = "selMoneyManagement.value=\"smartcyclestake\";inpCycleStake.value=" + aaq + ";chkSmart.checked=" + aap + ";selMoneyManagementChanged();";
  return aar;
};
Blockly.defineBlocksWithJsonArray([{
  type: "setmoneymanagementtofixedstake",
  message0: "Definir Gerenciamento: Stake Fixo %1 Stake Fixo: %2",
  args0: [{
    type: "input_end_row"
  }, {
    type: "input_value",
    name: "fixedstake_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.setmoneymanagementtofixedstake = function (aas, aat) {
  var aau = aat.valueToCode(aas, "fixedstake_nya", javascript.Order.ATOMIC);
  var aav = "stakeNow=" + aau + ";selMoneyManagement.value=\"fixedstake\";inpInitStake.value=" + aau + ";selMoneyManagementChanged();";
  return aav;
};
Blockly.defineBlocksWithJsonArray([{
  type: "settarget",
  message0: "Definir Metas (Stop Conditions) %1 %2 Meta de Lucro: %3 %4 Stop Loss: %5 %6 Qtde de Win(s): %7 %8 Qtde de Loss(es): %9 %10 Qtde de Entradas: %11 %12 Wins Seguidos: %13 %14 Loss(es) Seguidos: %15",
  args0: [{
    type: "input_end_row"
  }, {
    type: "field_checkbox",
    name: "check_targetprofit_nya",
    checked: true
  }, {
    type: "input_value",
    name: "targetprofit_nya"
  }, {
    type: "field_checkbox",
    name: "check_stoploss_nya",
    checked: false
  }, {
    type: "input_value",
    name: "stoploss_nya"
  }, {
    type: "field_checkbox",
    name: "check_numberofwins_nya",
    checked: false
  }, {
    type: "input_value",
    name: "numberofwins_nya"
  }, {
    type: "field_checkbox",
    name: "check_numberoflosses_nya",
    checked: false
  }, {
    type: "input_value",
    name: "numberoflosses_nya"
  }, {
    type: "field_checkbox",
    name: "check_numberofruns_nya",
    checked: false
  }, {
    type: "input_value",
    name: "numberofruns_nya"
  }, {
    type: "field_checkbox",
    name: "check_numberofwinsinarow_nya",
    checked: false
  }, {
    type: "input_value",
    name: "numberofwinsinarow_nya"
  }, {
    type: "field_checkbox",
    name: "check_numberoflossesinarow_nya",
    checked: false
  }, {
    type: "input_value",
    name: "numberoflossesinarow_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.settarget = function (aaw, aax) {
  var aay = aaw.getFieldValue("check_targetprofit_nya") === "TRUE";
  var aaz = aax.valueToCode(aaw, "targetprofit_nya", javascript.Order.ATOMIC);
  var aba = aaw.getFieldValue("check_stoploss_nya") === "TRUE";
  var abb = aax.valueToCode(aaw, "stoploss_nya", javascript.Order.ATOMIC);
  var abc = aaw.getFieldValue("check_numberofwins_nya") === "TRUE";
  var abd = aax.valueToCode(aaw, "numberofwins_nya", javascript.Order.ATOMIC);
  var abe = aaw.getFieldValue("check_numberoflosses_nya") === "TRUE";
  var abf = aax.valueToCode(aaw, "numberoflosses_nya", javascript.Order.ATOMIC);
  var abg = aaw.getFieldValue("check_numberofruns_nya") === "TRUE";
  var abh = aax.valueToCode(aaw, "numberofruns_nya", javascript.Order.ATOMIC);
  var abi = aaw.getFieldValue("check_numberofwinsinarow_nya") === "TRUE";
  var abj = aax.valueToCode(aaw, "numberofwinsinarow_nya", javascript.Order.ATOMIC);
  var abk = aaw.getFieldValue("check_numberoflossesinarow_nya") === "TRUE";
  var abl = aax.valueToCode(aaw, "numberoflossesinarow_nya", javascript.Order.ATOMIC);
  var abm = "chkTP.checked=" + aay + ";inpTP.value=" + aaz + ";chkSL.checked=" + aba + ";inpSL.value=" + abb + ";chkNumOfWin.checked=" + abc + ";inpNumOfWin.value=" + abd + ";chkNumOfLoss.checked=" + abe + ";inpNumOfLoss.value=" + abf + ";chkNumOfRun.checked=" + abg + ";inpNumOfRun.value=" + abh + ";chkNumOfWinInARow.checked=" + abi + ";inpNumOfWinInARow.value=" + abj + ";chkNumOfLossInARow.checked=" + abk + ";inpNumOfLossInARow.value=" + abl + ";";
  return abm;
};


// ===== VIRTUAL LOSS AVANÇADO - DEFINIÇÕES BLOCKLY =====

Blockly.defineBlocksWithJsonArray([
  {
  type: "setvirtuallose",
  message0: "Definir Virtual Loss %1 %2 Modo: %3 %4 Qtde (Modo Simples): %5 %6 Configuração Avançada: %7",
  args0: [
    {
    type: "input_end_row"
    },
    {
    type: "field_checkbox",
    name: "check_virtuallose_nya",
    checked: true
    },
    {
      type: "field_dropdown",
      name: "virtuallose_tipo",
      options: [
        ["Simples", "simples"],
        ["Avançado", "avancado"]
      ]
    },
    {
      type: "input_end_row"
    },
    {
    type: "input_value",
      name: "virtuallose_nya",
      check: "Number"
    },
    {
      type: "input_end_row"
    },
    {
      type: "input_statement",
      name: "virtuallose_config",
      check: null
    }
  ],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorpai,
  tooltip: "Configurar sistema de Virtual Loss com opções simples ou avançadas",
  helpUrl: ""
  },
  {
    type: "setvirtuallose_simples",
    message0: "Virtual Loss Simples %1 Qtde de Loss Virtual: %2",
    args0: [
      {
        type: "input_end_row"
      },
      {
        type: "input_value",
        name: "virtuallose_qtde"
      }
    ],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
    tooltip: "Modo simples: define a quantidade de losses virtuais",
  helpUrl: ""
  },
  {
    type: "setvirtuallose_intermediario",
    message0: "Virtual Loss Intermediário %1 Loss Virtual: %2 %3 Loss Real: %4",
    args0: [
      {
        type: "input_end_row"
      },
      {
        type: "input_value",
        name: "intermediario_loss_virtual"
      },
      {
        type: "input_end_row"
      },
      {
        type: "input_value",
        name: "intermediario_loss_real"
      }
    ],
    inputsInline: false,
    previousStatement: null,
    nextStatement: null,
    colour: colorkid,
    tooltip: "Alterna entre conta virtual e real conforme número de losses consecutivos",
    helpUrl: ""
  },
  {
    type: "setvirtuallose_win",
    message0: "Virtual Win %1 Qtde de Win Virtual para conta Real: %2",
    args0: [
      {
        type: "input_end_row"
      },
      {
        type: "input_value",
        name: "win_virtual_qtde"
      }
    ],
    inputsInline: false,
    previousStatement: null,
    nextStatement: null,
    colour: colorkid,
    tooltip: "Entra em conta real após X wins virtuais consecutivos",
    helpUrl: ""
  },
  {
    type: "setvirtuallose_padrao",
    message0: "Padrão VW/VL %1 Sequência (ex: VL,VL,VW): %2",
    args0: [
      {
        type: "input_end_row"
      },
      {
        type: "field_input",
        name: "padrao_sequencia",
        text: "VL,VL,VW"
      }
    ],
    inputsInline: false,
    previousStatement: null,
    nextStatement: null,
    colour: colorkid,
    tooltip: "Define uma sequência personalizada de VL (Loss Virtual) e VW (Win Virtual)",
    helpUrl: ""
  },
  {
    type: "setvirtuallose_progressivo",
    message0: "Modo Progressivo %1 Perdas Virtuais (X): %2 %3 Wins Reais Máx (Y): %4",
    args0: [
      {
        type: "input_end_row"
      },
      {
        type: "input_value",
        name: "progressivo_virtual_losses",
        check: "Number"
      },
      {
        type: "input_end_row"
      },
      {
        type: "input_value",
        name: "progressivo_real_wins",
        check: "Number"
      }
    ],
    inputsInline: false,
    previousStatement: null,
    nextStatement: null,
    colour: colorkid,
    tooltip: "Entra em real após X perdas virtuais. Permanece em real enquanto ganhar, até Y wins. Qualquer loss real volta para virtual.",
    helpUrl: ""
  }
]);

// ===== VIRTUAL LOSS AVANÇADO - GERADORES DE CÓDIGO =====

// Generator para bloco principal de Virtual Loss
javascript.javascriptGenerator.forBlock["setvirtuallose"] = function (abn, abo) {
  var abp = abn.getFieldValue("check_virtuallose_nya") === "TRUE";
  var tipo = abn.getFieldValue("virtuallose_tipo");
  
  // Suporte para modo antigo (input_value)
  var abq = abo.valueToCode(abn, "virtuallose_nya", javascript.Order.ATOMIC);
  
  // Suporte para modo novo (input_statement)
  var config_code = abo.statementToCode(abn, "virtuallose_config");

  var code = "// Configurar Virtual Loss\n";
  code += "chkVLose.checked = " + abp + ";\n";
  code += "selVLoseTipo.value = '" + tipo + "';\n";
  
  // Disparar evento de change para atualizar UI
  code += "selVLoseTipo.dispatchEvent(new Event('change'));\n";
  
  // Se tem valor no input antigo (virtuallose_nya), usar modo simples
  if (abq && abq !== '0' && abq !== '') {
    code += "// Modo Simples (compatibilidade)\n";
    code += "inpVLose.value = " + abq + ";\n";
    code += "inpVLoseIntermediarioVirtual.value = '';\n";
    code += "inpVLoseIntermediarioReal.value = '';\n";
    code += "inpVLoseWinVirtual.value = '';\n";
    code += "inpVLosePadrao.value = '';\n";
  }
  
  // Se tem configuração avançada (blocos conectados), executar
  if (config_code && config_code.trim() !== '') {
    code += config_code;
  }
  
  code += "cekValidasiSlaveToken();\n";
  code += "inicializarVirtualLoss();\n";
  
  return code;
};

// Generator para Virtual Loss Simples
javascript.javascriptGenerator.forBlock["setvirtuallose_simples"] = function (abn, abo) {
  var qtde = abo.valueToCode(abn, "virtuallose_qtde", javascript.Order.ATOMIC);
  var code = "// Modo Simples\n";
  code += "inpVLose.value = " + qtde + ";\n";
  code += "inpVLoseIntermediarioVirtual.value = '';\n";
  code += "inpVLoseIntermediarioReal.value = '';\n";
  code += "inpVLoseWinVirtual.value = '';\n";
  code += "inpVLosePadrao.value = '';\n";
  return code;
};

// Generator para Virtual Loss Intermediário
javascript.javascriptGenerator.forBlock["setvirtuallose_intermediario"] = function (abn, abo) {
  var loss_virtual = abo.valueToCode(abn, "intermediario_loss_virtual", javascript.Order.ATOMIC);
  var loss_real = abo.valueToCode(abn, "intermediario_loss_real", javascript.Order.ATOMIC);
  
  var code = "// Modo Intermediário\n";
  code += "selVLoseSubmodo.value = 'intermediario';\n";
  code += "selVLoseSubmodo.dispatchEvent(new Event('change'));\n";
  code += "inpVLose.value = 0;\n";
  code += "inpVLoseIntermediarioVirtual.value = " + loss_virtual + ";\n";
  code += "inpVLoseIntermediarioReal.value = " + loss_real + ";\n";
  code += "inpVLoseWinVirtual.value = '';\n";
  code += "inpVLosePadrao.value = '';\n";
  return code;
};

// Generator para Virtual Win
javascript.javascriptGenerator.forBlock["setvirtuallose_win"] = function (abn, abo) {
  var qtde = abo.valueToCode(abn, "win_virtual_qtde", javascript.Order.ATOMIC);
  
  var code = "// Modo Virtual Win\n";
  code += "selVLoseSubmodo.value = 'virtualwin';\n";
  code += "selVLoseSubmodo.dispatchEvent(new Event('change'));\n";
  code += "inpVLose.value = 0;\n";
  code += "inpVLoseIntermediarioVirtual.value = '';\n";
  code += "inpVLoseIntermediarioReal.value = '';\n";
  code += "inpVLoseWinVirtual.value = " + qtde + ";\n";
  code += "inpVLosePadrao.value = '';\n";
  return code;
};

// Generator para Padrão VW/VL
javascript.javascriptGenerator.forBlock["setvirtuallose_padrao"] = function (abn, abo) {
  var sequencia = abn.getFieldValue("padrao_sequencia");
  
  var code = "// Modo Padrão VW/VL\n";
  code += "selVLoseSubmodo.value = 'padrao';\n";
  code += "selVLoseSubmodo.dispatchEvent(new Event('change'));\n";
  code += "inpVLose.value = 0;\n";
  code += "inpVLoseIntermediarioVirtual.value = '';\n";
  code += "inpVLoseIntermediarioReal.value = '';\n";
  code += "inpVLoseWinVirtual.value = '';\n";
  code += "inpVLosePadrao.value = '" + sequencia.toUpperCase() + "';\n";
  code += "if (validarPadraoVLosePadrao('" + sequencia.toUpperCase() + "')) {\n";
  code += "  padraoVLoseSequencia = '" + sequencia.toUpperCase() + "'.split(',').map(i => i.trim());\n";
  code += "}\n";
  return code;
};

// Generator para Modo Progressivo
javascript.javascriptGenerator.forBlock["setvirtuallose_progressivo"] = function (abn, abo) {
  var virtual_losses = abo.valueToCode(abn, "progressivo_virtual_losses", javascript.Order.ATOMIC);
  var real_wins = abo.valueToCode(abn, "progressivo_real_wins", javascript.Order.ATOMIC);
  
  var code = "// Modo Progressivo\n";
  code += "selVLoseSubmodo.value = 'progressivo';\n";
  code += "selVLoseSubmodo.dispatchEvent(new Event('change'));\n";
  code += "inpVLose.value = 0;\n";
  code += "inpVLoseIntermediarioVirtual.value = '';\n";
  code += "inpVLoseIntermediarioReal.value = '';\n";
  code += "inpVLoseWinVirtual.value = '';\n";
  code += "inpVLosePadrao.value = '';\n";
  code += "inpVLoseProgressivoVirtual.value = " + virtual_losses + ";\n";
  code += "inpVLoseProgressivoRealWins.value = " + real_wins + ";\n";
  return code;
};

Blockly.defineBlocksWithJsonArray([{
  type: "setadditionalsettings",
  message0: "Definir Pausas %1 %2 Delay após Win (segundos): %3 %4 Delay após Loss (segundos): %5",
  args0: [{
    type: "input_end_row"
  }, {
    type: "field_checkbox",
    name: "check_delayafterwin_nya",
    checked: false
  }, {
    type: "input_value",
    name: "delayafterwin_nya"
  }, {
    type: "field_checkbox",
    name: "check_delayafterlose_nya",
    checked: true
  }, {
    type: "input_value",
    name: "delayafterlose_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.setadditionalsettings = function (abt, abu) {
  var abv = abt.getFieldValue("check_delayafterwin_nya") === "TRUE";
  var abw = abt.getFieldValue("delayafterwin_nya");
  var abx = abt.getFieldValue("check_delayafterlose_nya") === "TRUE";
  var aby = abt.getFieldValue("delayafterlose_nya");
  var abz = "chkDelayWin.checked=" + abv + ";inpDelayWin.value=" + abw + ";chkDelayLose.checked=" + abx + ";inpDelayLose.value=" + aby + ";";
  return abz;
};
Blockly.defineBlocksWithJsonArray([{
  type: "resultis",
  message0: "Result is %1",
  args0: [{
    type: "field_dropdown",
    name: "result_nya",
    options: [["Win", "win"], ["Loss", "loss"], ["Virtual Win", "virtualwin"], ["Virtual Loss", "virtualloss"]]
  }],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.resultis = function (aca, acb) {
  var acc = aca.getFieldValue("result_nya");
  var acd = "lastCont_result==\"" + acc + "\"";
  return [acd, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "readyfortrade",
  message0: "Ready For Trade",
  args0: [],
  previousStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: "",
  extensions: ["readyfortrade_onchange"]
}]);
javascript.javascriptGenerator.forBlock.readyfortrade = function (ace, acf) {
  var acg = "izinRun2=true;";
  return acg;
};
Blockly.Extensions.register("readyfortrade_onchange", function () {
  this.setOnChange(function (ach) {
    if (this.workspace.isDragging()) {
      return;
    }
    let aci;
    let acj;
    aci = this.getSurroundParent();
    acj = false;
    while (aci !== null) {
      if (aci.type === "runonceatstart") {
        acj = true;
        break;
      }
      ;
      aci = aci.getSurroundParent();
    }
    if (!acj) {
      this.previousConnection.disconnect();
      this.setWarningText("\"Ready For Trade\" precisa estar no bloco 1");
    } else {
      this.setWarningText(null);
    }
  });
});
Blockly.defineBlocksWithJsonArray([{
  type: "checkagain",
  message0: "Check Again",
  args0: [],
  previousStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: "",
  extensions: ["checkagain_onchange"]
}]);
javascript.javascriptGenerator.forBlock.checkagain = function (ack, acl) {
  var acm = "izinRun2=true;";
  return acm;
};
Blockly.Extensions.register("checkagain_onchange", function () {
  this.setOnChange(function (acn) {
    if (this.workspace.isDragging()) {
      return;
    }
    let aco;
    let acp;
    aco = this.getSurroundParent();
    acp = false;
    while (aco !== null) {
      if (aco.type === "purchaseconditions") {
        acp = true;
        break;
      }
      ;
      aco = aco.getSurroundParent();
    }
    if (!acp) {
      this.previousConnection.disconnect();
      this.setWarningText("\"Check Again\" precisa estar no bloco 2");
    } else {
      this.setWarningText(null);
    }
  });
});
Blockly.defineBlocksWithJsonArray([{
  type: "tradeagain",
  message0: "Trade Again",
  args0: [],
  previousStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: "",
  extensions: ["tradeagain_onchange"]
}]);
javascript.javascriptGenerator.forBlock.tradeagain = function (acq, acr) {
  var acs = "izinRun2=true;";
  return acs;
};
Blockly.Extensions.register("tradeagain_onchange", function () {
  this.setOnChange(function (act) {
    if (this.workspace.isDragging()) {
      return;
    }
    let acu;
    let acv;
    acu = this.getSurroundParent();
    acv = false;
    while (acu !== null) {
      if (acu.type === "restarttradingconditions") {
        acv = true;
        break;
      }
      ;
      acu = acu.getSurroundParent();
    }
    if (!acv) {
      this.previousConnection.disconnect();
      this.setWarningText("\"Trade Again\" precisa estar no bloco 4");
    } else {
      this.setWarningText(null);
    }
  });
});
Blockly.defineBlocksWithJsonArray([{
  type: "stopbot",
  message0: "Stop Robot",
  args0: [],
  previousStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.stopbot = function (acw, acx) {
  var acy = "if(btn_run.src.split(\"/\").pop() == \"icon_stop.png\"){btn_run.click();}";
  return acy;
};
Blockly.defineBlocksWithJsonArray([{
  type: "balance",
  message0: "Banca: %1",
  args0: [{
    type: "field_dropdown",
    name: "tipe_nya",
    options: [["Number", "number"], ["String", "string"]]
  }],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.balance = function (acz, ada) {
  var adb = acz.getFieldValue("tipe_nya");
  var adc = "";
  if (adb == "string") {
    adc = "\"" + summary_balance.innerText.split(" ")[0] + "\"";
  } else {
    adc = "summary_balance.innerText.split(\" \")[0]*1";
  }
  return [adc, Blockly.JavaScript.ORDER_NONE];
};
Blockly.defineBlocksWithJsonArray([{
  type: "summary",
  message0: "Summary: %1",
  args0: [{
    type: "field_dropdown",
    name: "data_nya",
    options: [["No. Of Runs", "noofruns"], ["Total Stake", "totalstake"], ["Total Payout", "totalpayout"], ["No. Of Win(s)", "win"], ["No. Of Loss(es)", "loss"], ["Total Profit/Loss", "totalprofitloss"]]
  }],
  output: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.summary = function (ade, adf) {
  var adg = ade.getFieldValue("data_nya");
  var adh = "summary_" + adg + ".innerText*1";
  return [adh, Blockly.JavaScript.ORDER_NONE];
};
const sleep = adi => {
  return new Promise(adj =>
  
  
  setTimeout(adj, adi));
};
Blockly.defineBlocksWithJsonArray([{
  type: "runafter",
  message0: "%1 Run After %2 Second(s)",
  args0: [{
    type: "input_statement",
    name: "statement_nya"
  }, {
    type: "input_value",
    name: "seconds_nya"
  }],
  inputsInline: true,
  previousStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.runafter = function (adk, adl) {
  var adm = adl.statementToCode(adk, "statement_nya");
  var adn = adl.valueToCode(adk, "seconds_nya", javascript.Order.ATOMIC);
  var ado = "sleep(" + adn * 1000 + ").then(() => {" + adm + ";})";
  return ado;
};

//BLOCOS DOS INDICADORES

Blockly.defineBlocksWithJsonArray([{
  type: "indicatorsmaarray",
  message0: "Média Móvel Simples (SMA) %1 Input List %2 Período %3 Saída %4",
  args0: [
    {"type": "input_end_row"},
    {"type": "input_value", "name": "inputlist_nya", "check": "Array"},
    {"type": "input_value", "name": "period_nya"},
    {
      "type": "field_dropdown",
      "name": "output_type",
      "options": [["Último Valor", "last"],["Lista Completa", "full"]]
    }
  ],
  inputsInline: false,
  output: "Array",
  colour: colorkid,
  tooltip: "Calcula a Média Móvel Simples (Simple Moving Average SMA) a partir de uma lista de preços",
  helpUrl: ""
}]);

javascript.javascriptGenerator.forBlock.indicatorsmaarray = function (block, generator) {
  const inputList = generator.valueToCode(block, 'inputlist_nya', javascript.Order.ATOMIC);
  const period = generator.valueToCode(block, 'period_nya', javascript.Order.ATOMIC);
  const outputType = block.getFieldValue('output_type');

  return [`calculateMovingAverageCandles(${inputList}, ${period}, '${outputType}')`, javascript.Order.NONE];
};

Blockly.defineBlocksWithJsonArray([{
  type: "indicatoremaarray",
  message0: "Média Móvel Exponencial (EMA) %1 Input List %2 Período %3 Saída %4",
  args0: [
    {"type": "input_end_row"},
    {"type": "input_value", "name": "inputlist_nya", "check": "Array"},
    {"type": "input_value", "name": "period_nya"},
    {
      "type": "field_dropdown",
      "name": "output_type",
      "options": [["Último Valor", "last"],["Lista Completa", "full"]]
    }
  ],
  inputsInline: false,
  output: "Array",
  colour: colorkid,
  tooltip: "Calcula a Média Móvel Exponencial (Exponential Moving Average EMA) a partir de uma lista de preços",
  helpUrl: ""
}]);

javascript.javascriptGenerator.forBlock.indicatoremaarray = function (block, generator) {
  const inputList = generator.valueToCode(block, 'inputlist_nya', javascript.Order.ATOMIC);
  const period = generator.valueToCode(block, 'period_nya', javascript.Order.ATOMIC);
  const outputType = block.getFieldValue('output_type');

  return [`calculateExponentialMovingAverage(${inputList}, ${period}, '${outputType}')`, javascript.Order.NONE];
};

function calculateExponentialMovingAverage(inputList, period, outputType) {
  // Verifica se são objetos de vela e extrai o preço de fechamento
  const isCandleData = inputList.length > 0 && typeof inputList[0] === 'object';
  const prices = isCandleData ? 
    inputList.map(candle => candle.close) : 
    inputList;

  // Verifica se há dados suficientes
  if (prices.length < period) {
    return outputType === 'last' ? null : [];
  }

  // Cálculo do fator de suavização
  const k = 2 / (period + 1);
  
  // Inicializa a EMA com a SMA dos primeiros 'period' valores
  let ema = [prices.slice(0, period).reduce((a, b) => a + b, 0) / period];
  
  // Calcula as EMAs subsequentes
  for (let i = period; i < prices.length; i++) {
    const currentEma = prices[i] * k + ema[ema.length - 1] * (1 - k);
    ema.push(currentEma);
  }

  // Retorna a saída com base na seleção do usuário
  if (outputType === 'last') {
    return ema[ema.length - 1]; // Retorna apenas o último valor
  }
  return ema; // Retorna a lista completa
}

Blockly.defineBlocksWithJsonArray([{
  type: "indicatorrsi",
  message0: "Índice de Força Relativa (RSI) %1 Input List %2 Período %3 Saída %4",
  args0: [
    {"type": "input_end_row"},
    {"type": "input_value", "name": "inputlist_nya", "check": "Array"},
    {"type": "input_value", "name": "period_nya"},
    {
      "type": "field_dropdown",
      "name": "output_type",
      "options": [["Último Valor", "last"], ["Lista Completa", "full"]]
    }
  ],
  inputsInline: false,
  output: null,
  colour: colorkid,
  tooltip: "Calcula o RSI a partir de uma lista de preços ou candles.",
  helpUrl: ""
}]);

javascript.javascriptGenerator.forBlock.indicatorrsi = function (block, generator) {
  const inputList = generator.valueToCode(block, 'inputlist_nya', javascript.Order.ATOMIC);
  const period = generator.valueToCode(block, 'period_nya', javascript.Order.ATOMIC);
  const outputType = block.getFieldValue('output_type');
  
  return [`calculateRSIArray(${inputList}, ${period}, '${outputType}')`, javascript.Order.NONE];
};

Blockly.defineBlocksWithJsonArray([{
  type: "indicatorbollingerbands",
  message0: "Bandas de Bollinger %1 Input List %2 Período %3 Desv. Padrão %4 Tipo Média %5 %6 Banda: %7 %8 Saída: %9",
  args0: [
    {"type": "input_end_row"},
    {"type": "input_value", "name": "inputlist_nya", "check": "Array"},
    {"type": "input_value", "name": "period_nya"},
    {"type": "input_value", "name": "multiplier_nya"},
    {
      "type": "field_dropdown",
      "name": "ma_type",
      "options": [["SMA", "sma"], ["EMA", "ema"]]
    },
    {"type": "input_end_row"},
    {
      "type": "field_dropdown",
      "name": "band_type",
      "options": [["Superior", "upper"], ["Média", "middle"], ["Inferior", "lower"]]
    },
    {"type": "input_end_row"},
    {
      "type": "field_dropdown",
      "name": "output_type",
      "options": [["Último Valor", "last"], ["Lista Completa", "full"]]
    }
  ],
  inputsInline: false,
  output: "Array",
  colour: colorkid,
  tooltip: "Retorna o valor das Bandas de Bollinger (Superior, Média ou Inferior) usando SMA ou EMA como base, em uma lista de valores históricos ou apenas o último valor.",
  helpUrl: ""
}]);

javascript.javascriptGenerator.forBlock.indicatorbollingerbands = function(block, generator) {
  const inputList = generator.valueToCode(block, 'inputlist_nya', javascript.Order.ATOMIC);
  const period = generator.valueToCode(block, 'period_nya', javascript.Order.ATOMIC);
  const multiplier = generator.valueToCode(block, 'multiplier_nya', javascript.Order.ATOMIC);
  const maType = block.getFieldValue('ma_type');
  const bandType = block.getFieldValue('band_type');
  const outputType = block.getFieldValue('output_type');
  
  return [`calculateBollingerBand(${inputList}, ${period}, ${multiplier}, '${maType}', '${bandType}', '${outputType}')`, javascript.Order.NONE];
};

Blockly.defineBlocksWithJsonArray([{
  type: "indicatorcci_ticks",
  message0: "Commodity Channel Index (CCI) Ticks %1 Input List %2 Period %3",
  args0: [{
    type: "input_end_row"
  }, {
    type: "input_value",
    name: "inputlist_nya"
  }, {
    type: "input_value",
    name: "period_nya"
  }],
  inputsInline: false,
  output: null,
  colour: colorkid,
  tooltip: "Commodity Channel Index (CCI) é um indicador técnico que mede a variação do preço em relação à média móvel de um ativo.",
  helpUrl: ""
}]);

javascript.javascriptGenerator.forBlock.indicatorcci_ticks = function (block, statemt) {
  var inputList = statemt.valueToCode(block, "inputlist_nya", javascript.Order.ATOMIC);
  var period = statemt.valueToCode(block, "period_nya", javascript.Order.ATOMIC);
  var cciCalculation = "calculateCCI_ticks(" + inputList + "," + period + ")";
  return [cciCalculation, Blockly.JavaScript.ORDER_NONE];
};

Blockly.defineBlocksWithJsonArray([{
    type: "indicator_atr_trailing_stop",
    message0: "ATR Trailing StopLoss %1 Input List %2 Período ATR %3 Período HHV %4 Multiplicador %5 Saída: %6",
    args0: [
        {"type": "input_end_row"},
        {"type": "input_value", "name": "inputlist_nya"},
        {"type": "input_value", "name": "atr_period_nya"},
        {"type": "input_value", "name": "hhv_period_nya"},
        {"type": "input_value", "name": "multiplier_nya"},
        {
            "type": "field_dropdown",
            "name": "output_type",
            "options": [
                ["Último Valor", "last"],
                ["Lista Completa", "full"]
            ]
        }
    ],
    inputsInline: false,
    output: "Array",
    colour: colorkid,
    tooltip: "Calcula o Trailing StopLoss usando o ATR."
}]);

javascript.javascriptGenerator.forBlock.indicator_atr_trailing_stop = function(block, generator) {
    const inputList = generator.valueToCode(block, 'inputlist_nya', javascript.Order.ATOMIC);
    const atrPeriod = generator.valueToCode(block, 'atr_period_nya', javascript.Order.ATOMIC);
    const hhvPeriod = generator.valueToCode(block, 'hhv_period_nya', javascript.Order.ATOMIC);
    const multiplier = generator.valueToCode(block, 'multiplier_nya', javascript.Order.ATOMIC);
    const outputType = block.getFieldValue('output_type');

    return [`calculateATRTrailingStop(${inputList}, ${atrPeriod}, ${hhvPeriod}, ${multiplier}, '${outputType}')`, javascript.Order.NONE];
};

Blockly.defineBlocksWithJsonArray([{
    type: "indicator_atr_trailing_stop_v2",
    message0: "ATR Trailing Stoploss V2 %1 Input List %2 Tipo de SL %3 %4 ATR Length %5 ATR Mult %6 SL% %7 SL Absoluto %8 Saída: %9",
    args0: [
        {"type": "input_end_row"},
        {"type": "input_value", "name": "inputlist_nya", "check": "Array"},
        {
            "type": "field_dropdown",
            "name": "sl_type",
            "options": [
                ["%", "percent"],
                ["ATR", "atr"],
                ["Absolute", "absolute"]
            ]
        },
        {"type": "input_end_row"},
        {"type": "input_value", "name": "atr_length", "check": "Number"},
        {"type": "input_value", "name": "atr_mult", "check": "Number"},
        {"type": "input_value", "name": "sl_perc", "check": "Number"},
        {"type": "input_value", "name": "sl_absol", "check": "Number"},
        {
            "type": "field_dropdown",
            "name": "output_type",
            "options": [
                ["Último Valor", "last"],
                ["Lista Completa", "full"]
            ]
        }
    ],
    inputsInline: false,
    output: "Array",
    colour: colorkid,
    tooltip: "Calcula o Trailing Stoploss usando o ATR (Versão 2)."
}]);

javascript.javascriptGenerator.forBlock.indicator_atr_trailing_stop_v2 = function(block, generator) {
    const inputList = generator.valueToCode(block, 'inputlist_nya', javascript.Order.ATOMIC);
    const slType = block.getFieldValue('sl_type');
    const slPerc = generator.valueToCode(block, 'sl_perc', javascript.Order.ATOMIC);
    const atrLength = generator.valueToCode(block, 'atr_length', javascript.Order.ATOMIC);
    const atrMult = generator.valueToCode(block, 'atr_mult', javascript.Order.ATOMIC);
    const slAbsol = generator.valueToCode(block, 'sl_absol', javascript.Order.ATOMIC);
    const outputType = block.getFieldValue('output_type');

    return [
        `calculateATRTrailingStopV2(${inputList}, '${slType}', ${slPerc}, ${atrLength}, ${atrMult}, ${slAbsol}, '${outputType}')`,
        javascript.Order.NONE
    ];
}



Blockly.defineBlocksWithJsonArray([{
  type: "indicatorcci",
  message0: "Commodity Channel Index (CCI) %1 Input List %2 Período %3 Tipo de Preço: %4 Saída: %5",
  args0: [
    {"type": "input_end_row"},
    {"type": "input_value", "name": "inputlist_nya", "check": "Array"},
    {"type": "input_value", "name": "period_nya"},
    {
      "type": "field_dropdown",
      "name": "price_type",
      "options": [
        ["Típico (HLC)", "typical"],
        ["Fechamento", "close"],
        ["Médio (HL/2)", "hl_avg"],
        ["Abertura", "open"]
      ]
    },
    {
      "type": "field_dropdown",
      "name": "output_type",
      "options": [["Último Valor", "last"], ["Lista Completa", "full"]]
    }
  ],
  inputsInline: false,
  output: "Array", // Mantemos como Array, mas vamos lidar com isso na função
  colour: colorkid,
  tooltip: "Calcula o CCI usando de uma lista de preços."
}]);
javascript.javascriptGenerator.forBlock.indicatorcci = function(block, generator) {
  const inputList = generator.valueToCode(block, 'inputlist_nya', javascript.Order.ATOMIC);
  const period = generator.valueToCode(block, 'period_nya', javascript.Order.ATOMIC);
  const priceType = block.getFieldValue('price_type');
  const outputType = block.getFieldValue('output_type');
  
  return [`calculateCCICandles(${inputList}, ${period}, '${priceType}', '${outputType}')`, javascript.Order.NONE];
};


Blockly.defineBlocksWithJsonArray([{
  type: "indicatoradx_ticks",
  message0: "Average Directional Index (ADX) Ticks %1 Input List %2 Period %3 %4 Type %5 Retorno %6",
  args0: [{
    type: "input_end_row"
  }, {
    type: "input_value",
    name: "inputlist_nya"
  }, {
    type: "input_value",
    name: "period_nya"
  }, {
    type: "input_end_row"
  },
  {
      "type": "field_dropdown",
      "name": "type_nya",
      "options": [["ADX", "adx"], ["+DI", "plusdi"], ["-DI", "minusdi"]]
    },
    {
      "type": "field_dropdown",
      "name": "output_type",
      "options": [["Último Valor", "last"], ["Lista Completa", "full"]]
    }
    ],
  inputsInline: false,
  output: null,
  colour: colorkid,
  tooltip: "Calcula o Índice Direcional Médio (ADX) ou os valores de plusDM/minusDM a partir de uma lista de ticks e um período.",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.indicatoradx_ticks = function (adu1, adv1) {
  var adw1 = adv1.valueToCode(adu1, "inputlist_nya", javascript.Order.ATOMIC);
  var adx1 = adv1.valueToCode(adu1, "period_nya", javascript.Order.ATOMIC);
  var type1 = adu1.getFieldValue("type_nya");
  var outputType = adu1.getFieldValue('output_type');
  var ady1 = `calculateADX_ticks(${adw1}, ${adx1}, '${type1}', '${outputType}')`;
  return [ady1, Blockly.JavaScript.ORDER_NONE];
};


Blockly.defineBlocksWithJsonArray([{
  type: "indicatoradx",
  message0: "Average Directional Index (ADX) %1 Lista de Velas %2 Período ADX %3 DI Length %4 Type %5 Saída %6",
  args0: [
    {"type": "input_end_row"},
    {"type": "input_value", "name": "inputlist_nya", "check": "Array"},
    {"type": "input_value", "name": "adx_period"},
    {"type": "input_value", "name": "di_length"},
    {
      "type": "field_dropdown",
      "name": "type_nya",
      "options": [["ADX", "adx"], ["+DI", "plusdi"], ["-DI", "minusdi"]]
    },
    {
      "type": "field_dropdown",
      "name": "output_type",
      "options": [["Lista Completa", "full"], ["Último Valor", "last"]]
    }
  ],
  inputsInline: false,
  output: "Array",
  colour: colorkid,
  tooltip: "Calcula o ADX usando dados de candles com DI Length personalizado",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.indicatoradx = function(block, generator) {
  const inputList = generator.valueToCode(block, 'inputlist_nya', javascript.Order.ATOMIC);
  const adxPeriod = generator.valueToCode(block, 'adx_period', javascript.Order.ATOMIC);
  const diLength = generator.valueToCode(block, 'di_length', javascript.Order.ATOMIC);
  const type = block.getFieldValue('type_nya');
  const outputType = block.getFieldValue('output_type');
  
  return [`calculateADXCandles(${inputList}, ${adxPeriod}, ${diLength}, '${type}', '${outputType}')`, javascript.Order.NONE];
};


Blockly.defineBlocksWithJsonArray([{
  type: "indicatortrarray",
  message0: "Average True Range (ATR) %1 Input List %2 Período ATR %3 Tipo de Saída %4",
  args0: [
    {"type": "input_end_row"},
    {"type": "input_value", "name": "inputlist_nya", "check": "Array"},
    {"type": "input_value", "name": "atr_period"},
    {
      "type": "field_dropdown",
      "name": "output_type",
      "options": [["Último Valor", "last"],["Lista Completa", "full"]]
    }
  ],
  inputsInline: false,
  output: "Array",
  colour: colorkid,
  tooltip: "Calcula o Average True Range a partir de uma lista de preços.",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.indicatortrarray = function (block, generator) {
  const inputList = generator.valueToCode(block, "inputlist_nya", javascript.Order.ATOMIC);
  const atrPeriod = generator.valueToCode(block, "atr_period", javascript.Order.ATOMIC);
  const outputType = block.getFieldValue("output_type");
  const atrCalculation = `calculateTrueRange(${inputList}, ${atrPeriod}, '${outputType}')`;
  return [atrCalculation, Blockly.JavaScript.ORDER_NONE];
};

Blockly.defineBlocksWithJsonArray([{
  type: "indicatortrarray_atrticks",
  message0: "Average True Range (ATR) Modo Ticks %1 Input List (Ticks) %2 Período ATR %3 Tipo de Saída %4",
  args0: [
    {"type": "input_end_row"},
    {"type": "input_value", "name": "inputlist_nya", "check": "Array"},
    {"type": "input_value", "name": "atr_period"},
    {
      "type": "field_dropdown",
      "name": "output_type",
      "options": [["Último Valor", "last"],["Lista Completa", "full"]]
    }
  ],
  inputsInline: false,
  output: "Array",
  colour: colorkid,
  tooltip: "Calcula o Average True Range a partir de uma lista de preços (ticks sequenciais).",
  helpUrl: ""
}]);

javascript.javascriptGenerator.forBlock.indicatortrarray_atrticks = function (block, generator) {
  const inputList = generator.valueToCode(block, "inputlist_nya", javascript.Order.ATOMIC);
  const atrPeriod = generator.valueToCode(block, "atr_period", javascript.Order.ATOMIC);
  const outputType = block.getFieldValue("output_type");
  const atrCalculation = `calculateTrueRangeTicks(${inputList}, ${atrPeriod}, '${outputType}')`;
  return [atrCalculation, Blockly.JavaScript.ORDER_NONE];
};

Blockly.defineBlocksWithJsonArray([{
  type: "indicadorsupertrend",
  message0: "SuperTrend %1 Input List %2 Período %3 Multiplicador %4 Saída %5 %6 Retorno %7",
  args0: [
    {"type": "input_end_row"},
    {"type": "input_value", "name": "inputlist_nya", "check": "Array"},
    {"type": "input_value", "name": "period"},
    {"type": "input_value", "name": "multiplier"},
    {
      "type": "field_dropdown",
      "name": "output_type",
      "options": [["Último Valor", "last"], ["Lista Completa", "full"]]
    },
    {"type": "input_end_row"},
    {
      "type": "field_dropdown",
      "name": "direction",
      "options": [["SuperTrend", "supertrend"], ["Direção", "direction"]]
    }
  ],
  inputsInline: false,
  output: "Array",
  colour: colorkid,
  tooltip: "Calcula o SuperTrend usando dados de candles com período e multiplicador personalizados"
}]);

javascript.javascriptGenerator.forBlock.indicadorsupertrend = function(block, generator) {
  const inputList = generator.valueToCode(block, 'inputlist_nya', javascript.Order.ATOMIC);
  const period = generator.valueToCode(block, 'period', javascript.Order.ATOMIC);
  const multiplier = generator.valueToCode(block, 'multiplier', javascript.Order.ATOMIC);
  const outputType = block.getFieldValue('output_type');
  const direction = block.getFieldValue('direction');
  
  return [`calculateSuperTrend(${inputList}, ${period}, ${multiplier}, '${outputType}', '${direction}')`, javascript.Order.NONE];
};


Blockly.defineBlocksWithJsonArray([{
  type: "indicadorsar",
  message0: "SAR Parabolic %1 Lista de Velas %2 Step %3 Max %4 Saída %5",
  args0: [
    {"type": "input_end_row"},
    {"type": "input_value", "name": "inputlist_nya", "check": "Array"},
    {"type": "input_value", "name": "step"},
    {"type": "input_value", "name": "max"},
    {
        "type": "field_dropdown",
        "name": "output_type",
        "options": [
          ["Último Valor", "last"],
          ["Lista Completa", "full"]
        ]
      }
  ],
  inputsInline: false,
  output: "Array",
  colour: colorkid,
  tooltip: "Calcula o SAR Parabolic usando dados de candles com step e max personalizados"
}]);
javascript.javascriptGenerator.forBlock.indicadorsar = function(block, generator) {
  const inputList = generator.valueToCode(block, 'inputlist_nya', javascript.Order.ATOMIC);
  const step = generator.valueToCode(block, 'step', javascript.Order.ATOMIC);
  const max = generator.valueToCode(block, 'max', javascript.Order.ATOMIC);
  const outputType = block.getFieldValue('output_type');
  
  return [`calculateSAR(${inputList}, ${step}, ${max}, '${outputType}')`, javascript.Order.NONE];
};

Blockly.defineBlocksWithJsonArray([{
  type: "indicator_tick_percentage",
  message0: "Percentual de Ticks %1 Input List %2 Período %3 %4 Saída %5 %6",
  args0: [{
    type: "input_end_row"
  }, {
    type: "input_value",
    name: "inputlist_nya"
  }, {
    type: "input_value",
    name: "period_nya"
  }, {
    type: "input_end_row"
  },
  {
    "type": "field_dropdown",
    "name": "type_nya",
    "options": [["Acima", "above"], ["Abaixo", "below"]]
  },
  {
    "type": "field_dropdown",
    "name": "output_type",
    "options": [["Último Valor", "last"], ["Lista Completa", "full"]]
  }
  ],
  inputsInline: false,
  output: null,
  colour: colorkid,
  tooltip: "Calcula o percentual de ticks acima ou abaixo durante o período especificado.",
  helpUrl: ""
}]);

javascript.javascriptGenerator.forBlock.indicator_tick_percentage = function (block, generator) {
  var inputList = generator.valueToCode(block, "inputlist_nya", javascript.Order.ATOMIC);
  var period = generator.valueToCode(block, "period_nya", javascript.Order.ATOMIC);
  var type = block.getFieldValue("type_nya");
  var outputType = block.getFieldValue('output_type');
  var code = `calculateTickPercentage(${inputList}, ${period}, '${type}', '${outputType}')`;
  return [code, Blockly.JavaScript.ORDER_NONE];
};


Blockly.defineBlocksWithJsonArray([{
  "type": "indicatorwilliamfractal",
  "message0": "William Fractal (Candles) %1 Input List (candles) %2 Período: %3 %4 Tipo: %5 Saída: %6 Formato: %7",
  "args0": [
    {"type": "input_end_row"},
    {"type": "input_value", "name": "inputlist_nya", "check": "Array"},
    {"type": "input_value", "name": "period", "check": "Number", "value": 2},
    {"type": "input_end_row"},
    {
      "type": "field_dropdown",
      "name": "fractal_type",
      "options": [
        ["Fractal de Alta", "high"],
        ["Fractal de Baixa", "low"]
      ]
    },
    {
      "type": "field_dropdown",
      "name": "output_type",
      "options": [
        ["Lista Completa", "full"],
        ["Último Fractal Confirmado", "last_confirmed"],
        ["Lista TF (Histórico Last Confirmed)", "tf_list"]
      ]
    },
    {
      "type": "field_dropdown",
      "name": "return_format",
      "options": [
        ["True/False", "bool"],
        ["Valor do Fractal", "value"]
      ]
    }
  ],
  "inputsInline": false,
  "output": "",
  "colour": "#5b80a5",
  "tooltip": "Identifica fractais em candles. 'Lista TF': histórico de confirmações para cada candle central."
}]);

javascript.javascriptGenerator.forBlock.indicatorwilliamfractal = function(block, generator) {
  const inputList = generator.valueToCode(block, 'inputlist_nya', javascript.Order.ATOMIC);
  const period = generator.valueToCode(block, 'period', javascript.Order.ATOMIC);
  const fractalType = block.getFieldValue('fractal_type');
  const outputType = block.getFieldValue('output_type');
  const returnFormat = block.getFieldValue('return_format');
  
  return [`calculateWilliamsFractalCandles(${inputList}, ${period}, '${fractalType}', '${outputType}', '${returnFormat}')`, javascript.Order.NONE];
};



function calculateWilliamsFractalCandles(candles, period, fractalType, outputType, returnFormat) {
  // Verificações básicas
  if (!Array.isArray(candles) || candles.length === 0) {
    return outputType === 'full' ? [] : (returnFormat === 'bool' ? false : null);
  }
  
  // Criar cópia dos candles excluindo a última vela (em formação)
  const closedCandles = candles.slice(0, -1);
  
  // Se não houver candles fechados suficientes, retorne vazio/false
  if (closedCandles.length === 0) {
    return outputType === 'full' ? [] : (returnFormat === 'bool' ? false : null);
  }
  
  const n = parseInt(period);
  
  // Função para verificar fractal de alta
  function isHighFractal(index, candleArray) {
    if (index < n || index >= candleArray.length - n) return false;
    
    const currentHigh = candleArray[index].high;
    for (let i = index - n; i <= index + n; i++) {
      if (i === index) continue;
      if (i < 0 || i >= candleArray.length) return false;
      if (currentHigh <= candleArray[i].high) return false;
    }
    return true;
  }
  
  // Função para verificar fractal de baixa
  function isLowFractal(index, candleArray) {
    if (index < n || index >= candleArray.length - n) return false;
    
    const currentLow = candleArray[index].low;
    for (let i = index - n; i <= index + n; i++) {
      if (i === index) continue;
      if (i < 0 || i >= candleArray.length) return false;
      if (currentLow >= candleArray[i].low) return false;
    }
    return true;
  }
  
  // Saída para "Lista TF"
  if (outputType === 'tf_list') {
    const result = [];
    
    // Para cada índice central possível nos candles fechados
    for (let centerIndex = n; centerIndex < closedCandles.length - n; centerIndex++) {
      if (fractalType === 'high') {
        result.push(isHighFractal(centerIndex, closedCandles));
      } else {
        result.push(isLowFractal(centerIndex, closedCandles));
      }
    }
    
    return result;
  }
  
  // Saída para "Último Fractal Confirmado"
  if (outputType === 'last_confirmed') {
    const lastIndex = closedCandles.length - n - 1;
    
    if (lastIndex < n) {
      return returnFormat === 'bool' ? false : null;
    }
    
    if (fractalType === 'high') {
      const isFractal = isHighFractal(lastIndex, closedCandles);
      if (returnFormat === 'value') {
        return isFractal ? closedCandles[lastIndex].high : null;
      }
      return isFractal;
    } else {
      const isFractal = isLowFractal(lastIndex, closedCandles);
      if (returnFormat === 'value') {
        return isFractal ? closedCandles[lastIndex].low : null;
      }
      return isFractal;
    }
  }
  
  // Saída para "Lista Completa"
  if (outputType === 'full') {
    if (returnFormat === 'value') {
      const fractalValues = [];
      
      for (let i = n; i < closedCandles.length - n; i++) {
        if (fractalType === 'high' && isHighFractal(i, closedCandles)) {
          fractalValues.push(closedCandles[i].high);
        } else if (fractalType === 'low' && isLowFractal(i, closedCandles)) {
          fractalValues.push(closedCandles[i].low);
        }
      }
      
      return fractalValues;
    } else {
      const result = [];
      
      for (let i = 0; i < closedCandles.length; i++) {
        if (i < n || i >= closedCandles.length - n) {
          result.push(false);
        } else if (fractalType === 'high') {
          result.push(isHighFractal(i, closedCandles));
        } else {
          result.push(isLowFractal(i, closedCandles));
        }
      }
      
      return result;
    }
  }
  
  return outputType === 'full' ? [] : (returnFormat === 'bool' ? false : null);
}

Blockly.defineBlocksWithJsonArray([{
  "type": "indicatorwilliamfractal_ticks",
  "message0": "William Fractal (Ticks) %1 Input List (ticks) %2 Período: %3 %4 Tipo: %5 Saída: %6 Formato: %7",
  "args0": [
    {"type": "input_end_row"},
    {"type": "input_value", "name": "inputlist_nya", "check": "Array"},
    {"type": "input_value", "name": "period", "check": "Number", "value": 2},
    {"type": "input_end_row"},
    {
      "type": "field_dropdown",
      "name": "fractal_type",
      "options": [
        ["Fractal de Alta", "high"],
        ["Fractal de Baixa", "low"]
      ]
    },
    {
      "type": "field_dropdown",
      "name": "output_type",
      "options": [
        ["Lista Completa", "full"],
        ["Último Fractal Confirmado", "last_confirmed"],
        ["Lista TF (Histórico Last Confirmed)", "tf_list"]
      ]
    },
    {
      "type": "field_dropdown",
      "name": "return_format",
      "options": [
        ["True/False", "bool"],
        ["Valor do Fractal", "value"]
      ]
    }
  ],
  "inputsInline": false,
  "output": "",
  "colour": "#5b80a5",
  "tooltip": "Identifica fractais em ticks. 'Lista TF': histórico completo de todos os valores last_confirmed calculados."
}]);

javascript.javascriptGenerator.forBlock.indicatorwilliamfractal_ticks = function(block, generator) {
  const inputList = generator.valueToCode(block, 'inputlist_nya', javascript.Order.ATOMIC);
  const period = generator.valueToCode(block, 'period', javascript.Order.ATOMIC);
  const fractalType = block.getFieldValue('fractal_type');
  const outputType = block.getFieldValue('output_type');
  const returnFormat = block.getFieldValue('return_format');
  
  return [`calculateWilliamsFractalTicks(${inputList}, ${period}, '${fractalType}', '${outputType}', '${returnFormat}')`, javascript.Order.NONE];
};


function calculateWilliamsFractalTicks(ticks, period, fractalType, outputType, returnFormat) {
  // Verificações básicas
  if (!Array.isArray(ticks)) {
    if (outputType === 'full') return [];
    if (outputType === 'tf_list') return [];
    if (outputType === 'last_confirmed') return returnFormat === 'bool' ? false : null;
    return [];
  }
  
  const totalTicks = ticks.length;
  const n = parseInt(period);
  const windowSize = 2 * n + 1;
  
  // Função para verificar se um tick é fractal
  function isFractal(centerIndex) {
    if (centerIndex < n || centerIndex >= totalTicks - n) return false;
    
    const currentPrice = ticks[centerIndex];
    
    for (let j = centerIndex - n; j <= centerIndex + n; j++) {
      if (j === centerIndex) continue;
      if (j < 0 || j >= totalTicks) return false;
      
      if (fractalType === 'high' && currentPrice <= ticks[j]) return false;
      if (fractalType === 'low' && currentPrice >= ticks[j]) return false;
    }
    
    return true;
  }
  
  // Saída para "Lista TF" (CORRIGIDA com índices corretos)
  if (outputType === 'tf_list') {
    const result = [];
    
    // Para cada índice central possível
    for (let centerIndex = n; centerIndex < totalTicks - n; centerIndex++) {
      result.push(isFractal(centerIndex));
    }
    
    return result;
  }
  
  // Saída para "Último Fractal Confirmado"
  if (outputType === 'last_confirmed') {
    if (totalTicks < windowSize) {
      return returnFormat === 'bool' ? false : null;
    }
    
    const centerIndex = totalTicks - n - 1;
    const isFractalResult = isFractal(centerIndex);
    
    if (returnFormat === 'value') {
      return isFractalResult ? ticks[centerIndex] : null;
    }
    
    return isFractalResult;
  }
  
  // Saída para "Lista Completa"
  if (outputType === 'full') {
    if (returnFormat === 'value') {
      const fractalValues = [];
      
      for (let i = n; i < totalTicks - n; i++) {
        if (isFractal(i)) {
          fractalValues.push(ticks[i]);
        }
      }
      
      return fractalValues;
    } else {
      const result = [];
      
      for (let i = 0; i < totalTicks; i++) {
        if (i < n || i >= totalTicks - n) {
          result.push(false);
        } else {
          result.push(isFractal(i));
        }
      }
      
      return result;
    }
  }
  
  return [];
}


Blockly.defineBlocksWithJsonArray([{
  "type": "indicatorzigzag_ticks",
  "message0": "Zig Zag (Ticks) %1 Input List (ticks) %2 Threshold: %3 %4 Depth (Pivot Legs): %5 %6 Tipo do Threshold: %7 Saída: %8",
  "args0": [
    {"type": "input_end_row"},
    {"type": "input_value", "name": "inputlist_nya", "check": "Array"},
    {"type": "input_value", "name": "threshold", "check": "Number", "value": 5},
    {"type": "input_end_row"},
    {"type": "input_value", "name": "depth", "check": "Number", "value": 5},
    {"type": "input_end_row"},
    {
      "type": "field_dropdown",
      "name": "threshold_type",
      "options": [
        ["Pontos", "points"],
        ["Percentual", "percent"]
      ]
    },
    {
      "type": "field_dropdown",
      "name": "output_type",
      "options": [
        ["Lista Completa", "full"],
        ["Último Ponto Confirmado", "last_confirmed"],
        ["Lista TF (Histórico Last Confirmed)", "tf_list"]
      ]
    }
  ],
  "inputsInline": false,
  "output": "",
  "colour": "#5b80a5",
  "tooltip": "Identifica pontos de reversão (Zig Zag) em ticks com Depth. 'Lista TF': histórico do último ponto confirmado ao longo do tempo. Depth: mínimo de ticks entre reversões."
}]);
javascript.javascriptGenerator.forBlock.indicatorzigzag_ticks = function(block, generator) {
  const inputList = generator.valueToCode(block, 'inputlist_nya', javascript.Order.ATOMIC);
  const threshold = generator.valueToCode(block, 'threshold', javascript.Order.ATOMIC);
  const depth = generator.valueToCode(block, 'depth', javascript.Order.ATOMIC);
  const thresholdType = block.getFieldValue('threshold_type');
  const outputType = block.getFieldValue('output_type');
  
  return [`calculateZigZagTicks(${inputList}, ${threshold}, ${depth}, '${thresholdType}', '${outputType}')`, javascript.Order.NONE];
};

function calculateZigZagTicks(ticks, threshold, depth, thresholdType, outputType) {
  // Verificações iniciais
  if (!Array.isArray(ticks)) {
    switch (outputType) {
      case 'full': return [];
      case 'tf_list': return [];
      case 'last_confirmed': return null;
    }
  }

  const n = ticks.length;
  if (n === 0) {
    switch (outputType) {
      case 'full': return [];
      case 'tf_list': return [];
      case 'last_confirmed': return null;
    }
  }

  // Inicializa estruturas de saída
  const fullList = new Array(n).fill(null);
  const tfList = []; // Lista TF modificada: apenas pontos confirmados
  let lastReversalPrice = ticks[0];
  let lastReversalIndex = 0;
  
  // Estado inicial
  let state = 'START';
  let currentExtremePrice = null;
  let currentExtremeIndex = null;
  const minDistance = Math.max(1, Math.floor(depth));

  // Primeiro tick sempre é um ponto de reversão
  fullList[0] = ticks[0];
  tfList.push({
    index: 0,
    value: ticks[0],
    type: 'start'
  });

  // Loop principal (começa do segundo tick)
  for (let i = 1; i < n; i++) {
    // Função auxiliar para calcular limiar
    function getCurrentThreshold(referencePrice) {
      return thresholdType === 'percent' 
        ? referencePrice * (threshold / 100) 
        : threshold;
    }

    switch (state) {
      case 'START':
        const diffUp = ticks[i] - lastReversalPrice;
        const diffDown = lastReversalPrice - ticks[i];
        const startThreshold = getCurrentThreshold(lastReversalPrice);

        if (diffUp >= startThreshold) {
          state = 'UPTREND';
          currentExtremePrice = ticks[i];
          currentExtremeIndex = i;
        } else if (diffDown >= startThreshold) {
          state = 'DOWNTREND';
          currentExtremePrice = ticks[i];
          currentExtremeIndex = i;
        }
        break;

      case 'UPTREND':
        if (ticks[i] > currentExtremePrice) {
          // Atualiza pico atual
          currentExtremePrice = ticks[i];
          currentExtremeIndex = i;
        } else {
          // Calcula retração
          const retrace = currentExtremePrice - ticks[i];
          const trendThreshold = getCurrentThreshold(currentExtremePrice);

          // Verifica se retração atinge limiar E respeita distância mínima
          if (retrace >= trendThreshold && (i - lastReversalIndex) >= minDistance) {
            fullList[currentExtremeIndex] = currentExtremePrice;
            
            // Adiciona novo ponto confirmado à lista TF
            tfList.push({
              index: currentExtremeIndex,
              value: currentExtremePrice,
              type: 'high'
            });
            
            lastReversalPrice = currentExtremePrice;
            lastReversalIndex = currentExtremeIndex;
            state = 'DOWNTREND';
            currentExtremePrice = ticks[i];
            currentExtremeIndex = i;
          }
        }
        break;

      case 'DOWNTREND':
        if (ticks[i] < currentExtremePrice) {
          // Atualiza vale atual
          currentExtremePrice = ticks[i];
          currentExtremeIndex = i;
        } else {
          // Calcula retração
          const retrace = ticks[i] - currentExtremePrice;
          const trendThreshold = getCurrentThreshold(currentExtremePrice);

          // Verifica se retração atinge limiar E respeita distância mínima
          if (retrace >= trendThreshold && (i - lastReversalIndex) >= minDistance) {
            fullList[currentExtremeIndex] = currentExtremePrice;
            
            // Adiciona novo ponto confirmado à lista TF
            tfList.push({
              index: currentExtremeIndex,
              value: currentExtremePrice,
              type: 'low'
            });
            
            lastReversalPrice = currentExtremePrice;
            lastReversalIndex = currentExtremeIndex;
            state = 'UPTREND';
            currentExtremePrice = ticks[i];
            currentExtremeIndex = i;
          }
        }
        break;
    }
  }

  // Verifica se o último extremo deve ser considerado
  if (currentExtremeIndex !== null && (n - 1 - lastReversalIndex) >= minDistance) {
    fullList[currentExtremeIndex] = currentExtremePrice;
    
    // Adiciona o último ponto confirmado à lista TF
    tfList.push({
      index: currentExtremeIndex,
      value: currentExtremePrice,
      type: state === 'UPTREND' ? 'high' : 'low'
    });
  }

  // Retorna conforme tipo de saída
  switch (outputType) {
    case 'full': 
      return fullList;
      
    case 'last_confirmed': 
      return tfList.length > 0 ? tfList[tfList.length - 1].value : null;
      
    case 'tf_list': 
      // Formata a saída TF para apenas valores em sequência
      return tfList.map(point => point.value);
      
    default: 
      return [];
  }
}

Blockly.defineBlocksWithJsonArray([{
  type: "indicator_stochastic_rsi",
  message0: "Stochastic RSI %1 Lista de Velas %2 Período RSI %3 Período Stochastic %4 K %5 D %6 Tipo de Saída %7 %8",
  args0: [
    {"type": "input_end_row"},
    {"type": "input_value", "name": "inputlist_nya", "check": "Array"},
    {"type": "input_value", "name": "rsi_period_nya"},
    {"type": "input_value", "name": "stoch_period_nya"},
    {"type": "input_value", "name": "k_Period"},
    {"type": "input_value", "name": "d_Period"},
    {
      "type": "field_dropdown",
      "name": "return_value",
      "options": [
        ["K", "K"],
        ["D", "D"]
      ]
    },
    {
      "type": "field_dropdown",
      "name": "output_type",
      "options": [
        ["Lista Completa", "full"],
        ["Último Valor", "last"]
      ]
    }
  ],
  inputsInline: false,
  output: null,
  colour: colorkid,
  tooltip: "Calcula o RSI Estocástico de uma lista de preços e retorna o valor selecionado.",
  helpUrl: ""
}]);

javascript.javascriptGenerator.forBlock.indicator_stochastic_rsi = function (block, generator) {
  const inputList = generator.valueToCode(block, "inputlist_nya", javascript.Order.ATOMIC);
  const rsiPeriod = generator.valueToCode(block, "rsi_period_nya", javascript.Order.ATOMIC);
  const stochPeriod = generator.valueToCode(block, "stoch_period_nya", javascript.Order.ATOMIC);
  const kPeriod = generator.valueToCode(block, "k_Period", javascript.Order.ATOMIC);
  const dPeriod = generator.valueToCode(block, "d_Period", javascript.Order.ATOMIC);
  
  // Obtém o valor selecionado no dropdown
  const returnValue = block.getFieldValue("return_value");
  const outputType = block.getFieldValue("output_type");

  // Gera o código para chamar a função de cálculo do RSI Estocástico
  const code = `calculateStochasticRSI(${inputList}, ${rsiPeriod}, ${stochPeriod}, ${kPeriod}, ${dPeriod})`;

  // Adiciona a lógica para retornar o valor correto
  if (returnValue === "K") {
    return outputType === 'last' ? [`${code}.kValues[${code}.kValues.length - 1]`, Blockly.JavaScript.ORDER_NONE] : [`${code}.kValues`, Blockly.JavaScript.ORDER_NONE];
  } else if (returnValue === "D") {
    return outputType === 'last' ? [`${code}.dValues[${code}.dValues.length - 1]`, Blockly.JavaScript.ORDER_NONE] : [`${code}.dValues`, Blockly.JavaScript.ORDER_NONE];
  }
  
  return [code, Blockly.JavaScript.ORDER_NONE]; // Caso padrão
};

Blockly.defineBlocksWithJsonArray([{
  type: "permutations_calculator",
  message0: "Permutações de Dígitos %1 Lista de Dígitos (únicos) %2 Tipo de Saída %3",
  args0: [
    {type: "input_end_row"},
    {
      type: "input_value",
      name: "INPUT_LIST",
      check: "Array",
      align: "RIGHT"
    },
    {
      type: "field_dropdown",
      name: "OUTPUT_TYPE",
      options: [
        ["Todas as permutações", "all"],
        ["Última permutação", "last"],
        ["Aleatória", "random"]
      ]
    }
  ],
  inputsInline: false,
  output: "Array",
  colour: colorkid,
  tooltip: "Gera permutações de uma lista de dígitos (2 a 7 dígitos únicos). Retorna lista de permutações ou permutação única conforme seleção.",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock['permutations_calculator'] = function(block, generator) {
  const inputList = generator.valueToCode(block, 'INPUT_LIST', javascript.Order.ATOMIC);
  const outputType = block.getFieldValue('OUTPUT_TYPE');
  
  const code = `calculatePermutations(${inputList}, '${outputType}')`;
  return [code, Blockly.JavaScript.ORDER_NONE];
};

function calculatePermutations(inputArray, outputType) {
  // Validação da entrada
  if (!Array.isArray(inputArray)) throw new Error("Entrada deve ser uma lista");
  if (inputArray.length < 2 || inputArray.length > 7) throw new Error("Lista deve ter entre 2 e 7 dígitos");
  
  const uniqueDigits = [...new Set(inputArray)];
  if (uniqueDigits.length !== inputArray.length) throw new Error("Dígitos devem ser únicos");
  
  // Função recursiva para gerar permutações
  function permute(arr, memo = []) {
    if (arr.length === 0) return [memo];
    
    return arr.flatMap((item, i) => {
      const rest = [...arr];
      rest.splice(i, 1);
      return permute(rest, [...memo, item]);
    });
  }

  const allPermutations = permute(inputArray);
  
  // Processa o tipo de saída
  switch(outputType) {
    case 'all': return allPermutations;
    case 'last': return allPermutations[allPermutations.length - 1] || [];
    case 'random': 
      const randomIndex = Math.floor(Math.random() * allPermutations.length);
      return allPermutations[randomIndex];
    default: return [];
  }
}

Blockly.defineBlocksWithJsonArray([{
  type: "notify_telegram",
  message0: "Notify Telegram: Access Token %1 Chat ID %2 Message %3",
  args0: [{
    type: "input_value",
    name: "token_nya"
  }, {
    type: "input_value",
    name: "chatid_nya"
  }, {
    type: "input_value",
    name: "message_nya"
  }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: colorkid,
  tooltip: "",
  helpUrl: ""
}]);
javascript.javascriptGenerator.forBlock.notify_telegram = function (p255, p256) {
  var v351 = p256.valueToCode(p255, "token_nya", javascript.Order.ATOMIC);
  var v352 = p256.valueToCode(p255, "chatid_nya", javascript.Order.ATOMIC);
  var v353 = p256.valueToCode(p255, "message_nya", javascript.Order.ATOMIC);
  var v354 = "sendToTelegram(" + v351 + "," + v352 + "," + v353 + ");";
  return v354;
};
Blockly.defineBlocksWithJsonArray([{
  "type": "countdown_next_candle",
  "message0": "Countdown para próxima vela %1 Período: %2",
  "args0": [
    {"type": "input_end_row"},
    {
      "type": "field_dropdown",
      "name": "granularity",
      "options": granularityNamesArray
    }
  ],
  "inputsInline": false,
  "output": "Number",
  "colour": "#5b80a5",
  "tooltip": "Retorna o tempo restante até a próxima vela do mercado na granularidade selecionada."
}]);
javascript.javascriptGenerator.forBlock.countdown_next_candle = function(block, generator) {
  const granularity = block.getFieldValue('granularity');
  
  return [`getCountdownNextCandle(${granularity})`, javascript.Order.NONE];
};

function getCountdownNextCandle(granularity) {
  const symbol = "1HZ10V";
  
  // Obter dados do mercado para o símbolo e granularidade
  const marketData = candleData[symbol]?.[granularity];
  
  // Retorna null se não houver dados atuais
  if (!marketData?.current) return null;

  // Calcular tempo restante usando dados do servidor
  const endTime = marketData.current.epoch + marketData.current.granularity;
  
  // Usar current_epoch se disponível (tempo atual do servidor)
  const currentEpoch = marketData.current.current_epoch || Math.floor(Date.now() / 1000);
  
  const remaining = endTime - currentEpoch;

  // Retorna o tempo restante ou 0 se já passou
  return remaining > 0 ? remaining : 0;
}






Blockly.defineBlocksWithJsonArray([{
  "type": "candle_value",
  "message0": "Valor da Vela: %1 Mercado: %2 Intervalo: %3 Posição: %4",
  "args0": [
    {
      "type": "field_dropdown",
      "name": "OHLC",
      "options": [
        ["Open", "open"],
        ["High", "high"],
        ["Low", "low"],
        ["Close", "close"],
        ["Open Time", "epoch"]
      ]
    },
    {
      "type": "field_dropdown",
      "name": "SYMBOL",
      //"options": arrMarket_Continuous.map(market => [market, market]) // Usando o array de mercados
      "options": arrPopulatedMarketAccu
    },
    {
      "type": "field_dropdown",
      "name": "GRANULARITY",
      "options": granularityNamesArray // Usando seu array de granularidades
    },
    {
      "type": "field_number",
      "name": "INDEX",
      "value": 0,
      "min": 0,
      "max": 999 // Ajuste conforme necessário
    }
  ],
  "output": "Number",
  "colour": "#5b67a5",
  "tooltip": "Obtém valores OHLC da vela selecionada. Posição 0 é a vela atual.",
  "helpUrl": ""
}]);

javascript.javascriptGenerator.forBlock.candle_value = function(block, generator) {
  const ohlc = block.getFieldValue('OHLC');
  const symbol = block.getFieldValue('SYMBOL');
  const granularity = block.getFieldValue('GRANULARITY');
  const index = block.getFieldValue('INDEX');

  let finalSymbol;

  if (symbol === "activemarket") {
    finalSymbol = "mainSymbol";
  } else if (symbol === "mainMarket_continuousindices") {
    finalSymbol = "mainMarket_continuousindices";
  } else {
    // Extrai o valor antes do pipe (ex: "R_10" de "R_10|Volatility 10 Index")
    const marketEntry = arrPopulatedMarketAccu.find(m => m[1] === symbol);
    finalSymbol = marketEntry ? `'${marketEntry[1].split('|')[0]}'` : `'${symbol}'`;
  }

  // Gera o código com a variável ou string correta
  const code = `getCandleValue('${ohlc}', ${finalSymbol}, '${granularity}', ${index})`;

  return [code, javascript.Order.ATOMIC];
};

Blockly.defineBlocksWithJsonArray([{
  "type": "candle_list",
  "message0": "Lista de Velas do mercado: %1 com o intervalo: %2",
  "args0": [
    {
      "type": "field_dropdown",
      "name": "SYMBOL",
      "options": arrPopulatedMarketAccu
    },
    {
      "type": "field_dropdown",
      "name": "GRANULARITY",
      "options": granularityNamesArray
    }
  ],
  "output": "Array",
  "colour": "#5b67a5",
  "tooltip": "Obtém a lista completa das 1000 velas (histórico + atual)",
  "helpUrl": ""
}]);

javascript.javascriptGenerator.forBlock.candle_list = function(block, generator) {
  const symbol = block.getFieldValue('SYMBOL');
  const granularity = block.getFieldValue('GRANULARITY');

  let finalSymbol;

  if (symbol === "activemarket") {
    finalSymbol = "mainSymbol";
  } else if (symbol === "mainMarket_continuousindices") {
    finalSymbol = "mainMarket_continuousindices";
  } else {
    const marketEntry = arrPopulatedMarketAccu.find(m => m[1] === symbol);
    finalSymbol = marketEntry ? `'${marketEntry[1].split('|')[0]}'` : `'${symbol}'`;
  }

  const code = `(() => {
    const market = ${finalSymbol};
    const g = '${granularity}';
    if (!candleData[market] || !candleData[market][g]) return [];
    return candleData[market][g].history.concat([candleData[market][g].current]);
  })()`;

  return [code, javascript.Order.ATOMIC];
};

Blockly.defineBlocksWithJsonArray([{
  "type": "candle_value_list",
  "message0": "Criar lista de valores %1 das velas: %2",
  "args0": [
    {
      "type": "field_dropdown",
      "name": "VALUE_TYPE",
      "options": [
        ["Open", "open"],
        ["High", "high"],
        ["Low", "low"],
        ["Close", "close"],
        ["Open Time", "epoch"]
      ]
    },
    {
      "type": "input_value",
      "name": "CANDLE_LIST"
    }
  ],
  "output": "Array",
  "colour": "#5b67a5",
  "tooltip": "Cria uma lista com os valores selecionados das velas fornecidas.",
  "helpUrl": ""
}]);

javascript.javascriptGenerator.forBlock.candle_value_list = function(block, generator) {
  const valueType = block.getFieldValue('VALUE_TYPE');
  const candleList = generator.valueToCode(block, 'CANDLE_LIST', javascript.Order.ATOMIC);

  // Gera o código para criar a lista de valores
  const code = `(() => {
    const candles = ${candleList};
    if (!Array.isArray(candles)) return [];
    return candles.map(candle => {
      switch ('${valueType}') {
        case 'open':
          return candle.open;
        case 'high':
          return candle.high;
        case 'low':
          return candle.low;
        case 'close':
          return candle.close;
        case 'epoch':
          return candle.epoch;
        default:
          return null;
      }
    });
  })()`;

  return [code, javascript.Order.ATOMIC];
};


Blockly.defineBlocksWithJsonArray([{
  "type": "indicator_sr_zones",
  "message0": "Zonas S/R %1 Velas %2 Janela (velas) %3 Sensibilidade %4 Min. toques %5 Offset %6 Tipo Saída %7 Dado %8",
  "args0": [
    {"type": "input_end_row"},
    {"type": "input_value", "name": "candles", "check": "Array"},
    {"type": "input_value", "name": "window_size", "check": "Number", "value": 100},
    {"type": "input_value", "name": "sensitivity", "check": "Number", "value": 1.0},
    {"type": "input_value", "name": "min_touches", "check": "Number", "value": 3},
    {"type": "input_value", "name": "zone_offset", "check": "Number", "value": 0.001},
    {
      "type": "field_dropdown",
      "name": "output_type",
      "options": [
        ["Zonas Ativas", "active"],
        ["Todos os Níveis", "all"],
        ["Última Zona", "last"]
      ]
    },
    {
      "type": "field_dropdown",
      "name": "data_field",
      "options": [
        ["Preço", "price"],
        ["Limite Superior", "upper"],
        ["Limite Inferior", "lower"],
        ["Força", "strength"],
        ["Tipo", "type"],
        ["Ativa", "isActive"],
        ["Toques Recentes", "recentTouches"],
        ["Rejeições Recentes", "recentRejections"]
      ]
    }
  ],
  "output": null, // Será definido dinamicamente
  "colour": "#5b80a5",
  "tooltip": "Detecta zonas de suporte e resistência dinâmicas",
  "helpUrl": ""
}]);

// Gerador de código JavaScript para o bloco
javascript.javascriptGenerator.forBlock['indicator_sr_zones'] = function(block, generator) {
  const candles = generator.valueToCode(block, 'candles', javascript.Order.ATOMIC);
  const window_size = generator.valueToCode(block, 'window_size', javascript.Order.ATOMIC);
  const sensitivity = generator.valueToCode(block, 'sensitivity', javascript.Order.ATOMIC);
  const min_touches = generator.valueToCode(block, 'min_touches', javascript.Order.ATOMIC);
  const zone_offset = generator.valueToCode(block, 'zone_offset', javascript.Order.ATOMIC);
  const output_type = block.getFieldValue('output_type');
  const data_field = block.getFieldValue('data_field');
  
  const code = `calculateSRZones(${candles}, ${window_size}, ${sensitivity}, ${min_touches}, ${zone_offset}, '${output_type}', '${data_field}')`;
  return [code, javascript.Order.NONE];
};

// Função principal de cálculo
function calculateSRZones(candles, window_size = 100, sensitivity = 1.0, min_touches = 3, zone_offset = 0.001, output_type = 'active', data_field = 'price') {
  // 1. Validar inputs
  if (!candles || candles.length < 50) {
    console.error("Dados insuficientes para cálculo de zonas S/R");
    return null;
  }
  
  // 2. Limitar a janela de análise
  const windowStart = Math.max(0, candles.length - window_size);
  const windowCandles = candles.slice(windowStart);
  
  // 3. Identificar níveis de rejeição
  const rejectionLevels = findRejectionLevels(windowCandles, sensitivity);
  
  // 4. Agrupar níveis em zonas
  const rawZones = clusterLevels(rejectionLevels, zone_offset);
  
  // 5. Filtrar zonas válidas
  const validZones = filterValidZones(rawZones, min_touches);
  
  // 6. Validar zonas com comportamento recente
  const activeZones = validateZones(validZones, windowCandles);
  
  // 7. Preparar saída com base no campo selecionado
  return getSelectedData(activeZones, validZones, output_type, data_field);
}

//--- Funções auxiliares ---//

// Identifica níveis com rejeição de preço
function findRejectionLevels(candles, sensitivity) {
  const levels = [];
  
  for (let i = 1; i < candles.length - 1; i++) {
    const candle = candles[i];
    const prevCandle = candles[i - 1];
    const nextCandle = candles[i + 1];
    
    // Cálculo da volatilidade relativa
    const avgRange = (candle.high - candle.low) / ((candle.high + candle.low) / 2);
    const dynamicSensitivity = sensitivity * (1 + avgRange * 10);
    
    // Verificar rejeição de topo
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const isUpperRejection = upperWick > dynamicSensitivity * Math.abs(candle.open - candle.close) &&
                            candle.high > prevCandle.high &&
                            candle.high > nextCandle.high;
    
    // Verificar rejeição de fundo
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const isLowerRejection = lowerWick > dynamicSensitivity * Math.abs(candle.open - candle.close) &&
                             candle.low < prevCandle.low &&
                             candle.low < nextCandle.low;
    
    if (isUpperRejection) levels.push({price: candle.high, type: 'resistance'});
    if (isLowerRejection) levels.push({price: candle.low, type: 'support'});
  }
  
  return levels;
}

// Agrupa níveis próximos em zonas
function clusterLevels(levels, zone_offset) {
  if (levels.length === 0) return [];
  
  // Ordenar por preço
  levels.sort((a, b) => a.price - b.price);
  
  const zones = [];
  let currentZone = {
    prices: [levels[0].price],
    types: [levels[0].type],
    sum: levels[0].price,
    count: 1
  };
  
  for (let i = 1; i < levels.length; i++) {
    const level = levels[i];
    const avgPrice = currentZone.sum / currentZone.count;
    
    if (Math.abs(level.price - avgPrice) <= zone_offset) {
      // Adicionar ao cluster atual
      currentZone.prices.push(level.price);
      currentZone.types.push(level.type);
      currentZone.sum += level.price;
      currentZone.count++;
    } else {
      // Finalizar cluster atual
      zones.push(finalizeZone(currentZone, zone_offset));
      
      // Iniciar novo cluster
      currentZone = {
        prices: [level.price],
        types: [level.type],
        sum: level.price,
        count: 1
      };
    }
  }
  
  // Adicionar último cluster
  zones.push(finalizeZone(currentZone, zone_offset));
  
  return zones;
}

// Finaliza a estrutura da zona
function finalizeZone(zoneData, zone_offset) {
  const avgPrice = zoneData.sum / zoneData.count;
  
  // Determinar tipo predominante
  const supportCount = zoneData.types.filter(t => t === 'support').length;
  const resistanceCount = zoneData.types.filter(t => t === 'resistance').length;
  const predominantType = supportCount > resistanceCount ? 'support' : 'resistance';
  
  return {
    price: avgPrice,
    upper: avgPrice * (1 + zone_offset),
    lower: avgPrice * (1 - zone_offset),
    strength: zoneData.count,
    type: predominantType,
    touches: zoneData.prices
  };
}

// Filtra zonas por força mínima
function filterValidZones(zones, min_touches) {
  return zones.filter(zone => zone.strength >= min_touches);
}

// Valida zonas com comportamento recente
function validateZones(zones, candles) {
  const recentCandles = candles.slice(-20); // Últimas 20 velas
  const currentPrice = recentCandles[recentCandles.length - 1].close;
  
  return zones.map(zone => {
    // Calcular distância do preço atual
    const distance = Math.abs(zone.price - currentPrice) / currentPrice;
    
    // Verificar toques recentes
    const recentTouches = recentCandles.filter(c => 
      c.low <= zone.upper && c.high >= zone.lower
    ).length;
    
    // Verificar rejeições recentes
    const recentRejections = recentCandles.filter(c => {
      const isSupportRejection = zone.type === 'support' && 
                                c.low <= zone.upper && 
                                c.close > zone.lower;
      
      const isResistanceRejection = zone.type === 'resistance' && 
                                  c.high >= zone.lower && 
                                  c.close < zone.upper;
      
      return isSupportRejection || isResistanceRejection;
    }).length;
    
    return {
      ...zone,
      isActive: distance < 0.03 && recentRejections > 0,
      recentTouches,
      recentRejections
    };
  });
}


// Função para extrair o dado selecionado
function getSelectedData(activeZones, allZones, output_type, data_field) {
  // Determinar quais zonas usar
  let zones = [];
  switch(output_type) {
    case 'active':
      zones = activeZones.filter(z => z.isActive);
      break;
    case 'all':
      zones = allZones;
      break;
    case 'last':
      const active = activeZones.filter(z => z.isActive);
      zones = active.length > 0 ? [active[active.length - 1]] : [];
      break;
    default:
      zones = activeZones.filter(z => z.isActive);
  }
  
  // Retornar o campo solicitado
  switch(data_field) {
    case 'price':
      return zones.map(z => z.price);
    case 'upper':
      return zones.map(z => z.upper);
    case 'lower':
      return zones.map(z => z.lower);
    case 'strength':
      return zones.map(z => z.strength);
    case 'type':
      return zones.map(z => z.type);
    case 'isActive':
      return zones.map(z => z.isActive ? 1 : 0); // Retorna 1 para true, 0 para false
    case 'recentTouches':
      return zones.map(z => z.recentTouches);
    case 'recentRejections':
      return zones.map(z => z.recentRejections);
    default:
      return zones.map(z => z.price);
  }
}

const blockly_reset = () => {
  if (confirm("Resetar/Zerar estratégia. Tem certeza?")) {
    Blockly.getMainWorkspace().clear();
    Blockly.serialization.workspaces.load(JSON.parse(initWorkspaceBlock), Blockly.getMainWorkspace());
    localStorage.setItem("mainRobotName", "Nenhum");
    spanSimpleRobotName.innerText = "Nenhum";
  }
};
if (localStorage.getItem("blockly_workspace_state") != null) {
  Blockly.serialization.workspaces.load(JSON.parse(localStorage.getItem("blockly_workspace_state")), Blockly.getMainWorkspace());
} else {
  Blockly.serialization.workspaces.load(JSON.parse(initWorkspaceBlock), Blockly.getMainWorkspace());
}

function blockly_save() {
    const state = Blockly.serialization.workspaces.save(Blockly.getMainWorkspace());
    
    // Adicionar metadados
    state.metadata = {
        name: localStorage.getItem("mainRobotName") || "Meu Bot",
        savedAt: new Date().toISOString(),
        version: "1.0"
    };
    
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], {type: 'application/json'});
    
    saveJsonObjToFile(state, "pontobots.ptbot");
}

const blockly_workspaceChangedResponse = ael => {
  const aem = Blockly.serialization.workspaces.save(Blockly.getMainWorkspace());
  localStorage.setItem("blockly_workspace_state", JSON.stringify(aem));
};
const blockly_undo = () => {
  Blockly.getMainWorkspace().undo(false);
};
const blockly_redo = () => {
  Blockly.getMainWorkspace().undo(true);
};
const blockly_arrange = () => {
  Blockly.getMainWorkspace().cleanUp();
};



// dragElement chamado após DOM pronto para evitar null em getElementById
// (o script tem type="module", que executa antes do parser terminar o body)
document.addEventListener('DOMContentLoaded', () => {
  const _de1 = document.getElementById("mydivSummary");
  const _de2 = document.getElementById("mydivLog");
  //const _de3 = document.getElementById("mydivTW");
  if (_de1) dragElement(_de1);
  if (_de2) dragElement(_de2);
  //if (_de3) dragElement(_de3);
});
function dragElement(aen) {
  if (!aen) return;  // guarda: elemento não encontrado no DOM
  var aeo = 0;
  var aep = 0;
  var aeq = 0;
  var aer = 0;
  if (document.getElementById(aen.id + "header")) {
    document.getElementById(aen.id + "header").onmousedown = aes;
  } else {
    aen.onmousedown = aes;
  }
  function aes(aet) {
    aet = aet || window.event;
    aet.preventDefault();
    aeq = aet.clientX;
    aer = aet.clientY;
    document.onmouseup = aeu;
    document.onmousemove = aev;
  }
  function aev(aew) {
    aew = aew || window.event;
    aew.preventDefault();
    aeo = aeq - aew.clientX;
    aep = aer - aew.clientY;
    aeq = aew.clientX;
    aer = aew.clientY;
    aen.style.top = aen.offsetTop - aep + "px";
    aen.style.left = aen.offsetLeft - aeo + "px";
    if (aen.offsetTop < aen.offsetHeight * 0.5) {
      aen.style.top = aen.offsetHeight * 0.5 + "px";
    }
    if (aen.offsetLeft < -aen.offsetWidth * 0.4) {
      aen.style.left = -aen.offsetWidth * 0.4 + "px";
    }
  }
  function aeu() {
    document.onmouseup = null;
    document.onmousemove = null;
  }
}
const moveBoxSummaryTop = () => {
  document.getElementById("mydivLog").style.zIndex = 102;
  document.getElementById("mydivSummary").style.zIndex = 103;
  //document.getElementById("mydivTW").style.zIndex = 101;
};
const moveBoxLogTop = () => {
  document.getElementById("mydivSummary").style.zIndex = 102;
  document.getElementById("mydivLog").style.zIndex = 103;
  //document.getElementById("mydivTW").style.zIndex = 101;
};
/*const moveBoxTWTop = () => {
    document.getElementById("mydivLog").style.zIndex = 102;
    document.getElementById("mydivSummary").style.zIndex = 101;
    document.getElementById("mydivTW").style.zIndex = 103;
};
*/

const clearBoxSummary = () => {
  let aex = false;
  for (i = 0; i < prContract.length; i++) {
    if (prContract[i] != 0) {
      aex = true;
      break;
    }
    ;
  }
  ;
  if (aex) {
    writeLog("", "Aguarde a finalização do contrato.");
    return;
  }
  if (confirm("Isso limpará todas as transações no painel e todos os contadores serão zerados.")) {
    document.getElementById("tableSummaryTBODY").innerHTML = "<tr id=\"tableSummaryTRATAS\"><th style=\"width: 190px;\">Timestamp</th><th>Trade Type</th><th>Entry Spot</th><th>Exit Spot</th><th>Buy Price</th><th>Profit/Loss</th></tr>";
    summary_noofruns.innerText = summary_totalstake.innerText = summary_totalpayout.innerText = summary_win.innerText = summary_loss.innerText = summary_totalprofitloss.innerText = 0;
    totalProfit = 0;
    winContract = [];
    loseContract = [];
    tempWinInARow = 0;
    tempLossInARow = 0;
    arrsellProfitLoss_multimarket = [];
    arr_multimarketVendido = [];
    sellProfitLoss = [];
  }
};
const showBoxSummary = () => {
  document.getElementById("mydivSummary").style.display = "block";
  moveBoxSummaryTop();
};
const closeBoxSummary = () => {
  document.getElementById("mydivSummary").style.display = "none";
};
closeBoxSummary();
const clearBoxLog = () => {
  document.getElementById("tableLogTBODY").innerHTML = "<tr><td style=\"width: 25%;\"></td><td></td></tr>";
};
const showBoxLog = () => {
  document.getElementById("mydivLog").style.display = "flex";
  moveBoxLogTop();
};
const closeBoxLog = () => {
  document.getElementById("mydivLog").style.display = "none";
};
closeBoxLog();

/*
const showBoxTW = () => {
    document.getElementById("mydivTW").style.display = "flex";
    moveBoxTWTop();
};
const closeBoxTW = () => {
    document.getElementById("mydivTW").style.display = "none";
};
closeBoxTW();
*/


const hideshowsidebar = () => {
  if (document.getElementById("btn_hideshowsidebar").src.split("/").pop() === "icon_hidesidebar2.png") {
    document.getElementById("btn_hideshowsidebar").src = "image/icon_showsidebar2.png";
    document.getElementById("body_main").style.gridTemplateColumns = "0% 0% auto";
  } else {
    document.getElementById("btn_hideshowsidebar").src = "image/icon_hidesidebar2.png";
    document.getElementById("body_main").style.gridTemplateColumns = "0% 170px auto";
  }
  
  
  setTimeout(() => {
    Blockly.svgResize(Blockly.getMainWorkspace());
  }, 600);
};

const hideshowdatabox = () => {
  if (document.getElementById("btn_hideshowdatabox").src.split("/").pop() === "icon_hidedatabox2.png") {
    document.getElementById("btn_hideshowdatabox").src = "image/icon_showdatabox2.png";
    document.getElementById("body_main").style.gridTemplateRows = "7% 93% 0%";
  } else {
    document.getElementById("btn_hideshowdatabox").src = "image/icon_hidedatabox2.png";
    document.getElementById("body_main").style.gridTemplateRows = "7% 46.5% 46.5%";
  }
  
  
  setTimeout(() => {
    Blockly.svgResize(Blockly.getMainWorkspace());
  }, 600);
};
const hideshowtoolbox = () => {
  if (document.getElementById("btn_hideshowtoolbox").src.split("/").pop() === "icon_hidetoolbox2.png") {
    document.getElementById("btn_hideshowtoolbox").src = "image/icon_showtoolbox2.png";
    Blockly.getMainWorkspace().getToolbox().setVisible(false);
  } else {
    document.getElementById("btn_hideshowtoolbox").src = "image/icon_hidetoolbox2.png";
    Blockly.getMainWorkspace().getToolbox().setVisible(true);
  }
  
  
  setTimeout(() => {
    Blockly.svgResize(Blockly.getMainWorkspace());
  }, 0);
};

const switchtosimplemode = () => {
  document.getElementById("body_main").style.gridTemplateColumns = "100% 0% 0%";
  document.getElementById("body_main").style.gridTemplateRows = "15% 85% 0%";
  
  
  setTimeout(() => {
    Blockly.svgResize(Blockly.getMainWorkspace());
  }, 600);
  localStorage.setItem("initStateMode", "simple");
};
const switchtoadvancedmode = () => {
  document.getElementById("body_main").style.gridTemplateColumns = "0% 170px auto";
  document.getElementById("body_main").style.gridTemplateRows = "7% 93% 0%";
  
  
  setTimeout(() => {
    Blockly.svgResize(Blockly.getMainWorkspace());
  }, 600);
  localStorage.setItem("initStateMode", "advanced");
};
const updateStatusBotRunning = aey => {
  document.getElementById("status_bot_running").innerText = aey;
};
const selMoneyManagementChanged = () => {
  if (selMoneyManagement.value == "smartmartingale") {
    lblInpInitStake.innerText = "Stake Inicial";
    divInpInitStake.hidden = false;
    divInpMartiFactor.hidden = false;
    divInpCycleStake.hidden = true;
    divChkSmart.hidden = false;
  } else {
    if (selMoneyManagement.value == "smartcyclestake") {
      divInpInitStake.hidden = true;
      divInpMartiFactor.hidden = true;
      divInpCycleStake.hidden = false;
      divChkSmart.hidden = false;
    } else {
      if (selMoneyManagement.value == "fixedstake") {
        lblInpInitStake.innerText = "Stake Fixo";
        divInpInitStake.hidden = false;
        divInpMartiFactor.hidden = true;
        divInpCycleStake.hidden = true;
        divChkSmart.hidden = true;
      }
    }
  }
};
selMoneyManagementChanged();
const getStakeBegin = () => {
  tempLossInARow = 0;
  if (selMoneyManagement.value == "smartmartingale") {
    return inpInitStake.value;
  } else {
    if (selMoneyManagement.value == "smartcyclestake") {
      posCycleStake = 0;
      return inpCycleStake.value.split(",")[posCycleStake];
    } else {
      if (selMoneyManagement.value == "fixedstake") {
        return inpInitStake.value;
      }
    }
  }
};
const getStakeAfterLose = aez => {
  if (selMoneyManagement.value == "smartmartingale") {
    return aez * inpMartiFactor.value;
  } else {
    if (selMoneyManagement.value == "smartcyclestake") {
      if (posCycleStake < inpCycleStake.value.split(",").length - 1) {
        posCycleStake++;
      } else {
        posCycleStake = 0;
      }
      return inpCycleStake.value.split(",")[posCycleStake];
    } else {
      if (selMoneyManagement.value == "fixedstake") {
        return inpInitStake.value;
      }
    }
  }
};
const loadRobot = (afc, afd) => {
  if (confirm("O bot atual será substituído. Clique OK se você tem certeza ou CANCEL para cancelar a troca.")) {
    localStorage;
    $.getJSON("robot/" + afd + ".ptbot", function (afe) {
      Blockly.serialization.workspaces.load(afe, Blockly.getMainWorkspace());
    });
    localStorage.setItem("mainRobotName", afc);
    spanSimpleRobotName.innerText = afc;
    document.getElementById("divPopupRobot").style.display = "none";
  } else {}
};
const fillDataLastCont = (afk, afl, afm, afn, afo, afp, afq, afr, afs, aft, afu, afmkt, afv, afw) => {
  lastCont_askprice = afk;
  lastCont_payout = afl;
  lastCont_profit = afm;
  lastCont_contracttype = afn;
  lastCont_entrytime = new Date(afo * 1000);
  lastCont_entryvalue = afp;
  lastCont_entryvaluestring = afq;
  lastCont_exittime = new Date(afr * 1000);
  lastCont_exitvalue = afs;
  lastCont_exitvaluestring = aft;
  lastCont_barrier = afu;
  lastCont_result = afw ? afm >= 0 ? "virtualwin" : "virtualloss" : afm >= 0 ? "win" : "loss";
  lastCont_market = afmkt;
};
$(document).ready(function () {
  $("#myInput").on("keyup", function () {
    var afx = $(this).val().toLowerCase();
    $("#myTableBody tr").filter(function () {
      $(this).toggle($(this).text().toLowerCase().indexOf(afx) > -1);
    });
  });
});
const injectFunctionRobotTable = () => {
  var afy = document.getElementById("myTableBody");
  var afz = afy.getElementsByTagName("tr");
  for (let aga = 0; aga < afz.length; aga++) {
    let agb = afy.rows[aga];
    agb.onclick = () => {
      loadRobot(agb.cells[1].innerText, agb.cells[0].innerText);
    };
  }
  document.getElementById("spanJumRobot").innerText = document.getElementById("myTableBody").rows.length;
};
//injectFunctionRobotTable();

// ===== VIRTUAL LOSS AVANÇADO - FUNÇÕES DE VALIDAÇÃO =====

/**
 * Valida o padrão VL/VW inserido pelo usuário
 * @param {string} padrao - Sequência no formato "VL,VL,VW" ou "vl,vl,vw"
 * @returns {boolean} true se válido, false caso contrário
 */
function validarPadraoVLosePadrao(padrao) {
  if (!padrao || padrao.trim().length === 0) {
    console.error("[VirtualLoss] Padrão vazio!");
    $.notify("Padrão VL/VW não pode estar vazio", {
      position: "bottom left",
      className: "error"
    });
    return false;
  }

  const itens = padrao.toUpperCase().split(',').map(item => item.trim());
  
  // Verifica se há ao menos um item
  if (itens.length === 0) {
    console.error("[VirtualLoss] Padrão deve ter ao menos um item");
    $.notify("Padrão deve ter ao menos um item", {
      position: "bottom left",
      className: "error"
    });
    return false;
  }

  // Verifica se todos os itens são VL ou VW
  const validos = itens.every(item => item === 'VL' || item === 'VW');
  if (!validos) {
    console.error("[VirtualLoss] Padrão contém caracteres inválidos. Use apenas VL ou VW");
    $.notify("Padrão inválido! Use apenas VL ou VW separados por vírgula", {
      position: "bottom left",
      className: "error"
    });
    return false;
  }

  console.log("[VirtualLoss] Padrão validado:", itens);
  return true;
}

/**
 * Determina qual modo de Virtual Loss está ativo
 * @returns {string} 'simples', 'intermediario', 'virtualwin', 'padrao' ou 'nenhum'
 */
function obterModoVirtualLossAtivo() {
  if (!chkVLose.checked) {
    return 'nenhum';
  }

  const tipo = selVLoseTipo.value;
  
  if (tipo === 'simples') {
    return inpVLose.value > 0 ? 'simples' : 'nenhum';
  }
  
  if (tipo === 'avancado') {
    // Modo Intermediário
    if (inpVLoseIntermediarioVirtual.value > 0 && inpVLoseIntermediarioReal.value > 0) {
      return 'intermediario';
    }
    
    // Modo Virtual Win
    if (inpVLoseWinVirtual.value > 0) {
      return 'virtualwin';
    }
    
    // Modo Padrão
    if (inpVLosePadrao.value.trim().length > 0) {
      return validarPadraoVLosePadrao(inpVLosePadrao.value) ? 'padrao' : 'nenhum';
    }
    // Modo Progressivo
    if (inpVLoseProgressivoVirtual.value > 0 && inpVLoseProgressivoRealWins.value > 0) {
      return 'progressivo';
    }
  }
  
  return 'nenhum';
}

// ===== VIRTUAL LOSS AVANÇADO - CONTROLE DE ESTADO =====

/**
 * Reseta todos os contadores de Virtual Loss
 */
function resetarVirtualLossState() {
  countVLose = 0;
  countVLoseIntermediarioVirtual = 0;
  countVLoseIntermediarioReal = 0;
  countVLoseWinVirtual = 0;
  padraoVLoseAtualIndex = 0;
  countVLoseProgressivoVirtual = 0;      // ADICIONAR
  countVLoseProgressivoRealWins = 0;     // ADICIONAR
  emModoVirtual = true;
  
  console.log("[VirtualLoss] Estado resetado");
}

/**
 * Inicializa o sistema de Virtual Loss
 * Deve ser chamado quando o bot inicia
 */
function inicializarVirtualLoss() {
  resetarVirtualLossState();
  
  const modo = obterModoVirtualLossAtivo();
  
  // Se modo padrão, parsear a sequência
  if (modo === 'padrao') {
    const sequencia = inpVLosePadrao.value.toUpperCase().split(',').map(item => item.trim());
    padraoVLoseSequencia = sequencia;
    console.log("[VirtualLoss] Modo Padrão inicializado com sequência:", padraoVLoseSequencia);
  }
  
  console.log("[VirtualLoss] Sistema inicializado - Modo:", modo);
}

/**
 * Decide qual conta usar (virtual ou real) baseado no resultado da operação
 * @param {string} resultado - 'win' ou 'loss'
 * @returns {boolean} true = usar conta real, false = usar conta virtual
 */
function decidirModoVirtualLoss(resultado) {
  const modo = obterModoVirtualLossAtivo();
  
  if (modo === 'nenhum') {
    // Virtual Loss desativado - sempre usar conta real
    return true;
  }
  
  // ===== MODO SIMPLES =====
  if (modo === 'simples') {
    if (resultado === 'win') {
      // Win virtual reseta o contador
      countVLose = 0;
      emModoVirtual = true;
      writeLog("", "[Virtual Loss Simples] Win Virtual - Contador resetado");
      return false; // continua no virtual
    } else {
      // Loss virtual incrementa o contador
      countVLose++;
      writeLog("", "[Virtual Loss Simples] Loss #" + countVLose + "/" + inpVLose.value);
      
      if (countVLose >= inpVLose.value) {
        // Atingiu o limite - próxima operação será em real
        emModoVirtual = false;
        writeLog("", "[Virtual Loss Simples] Limite atingido - Próxima operação em CONTA REAL");
        return true; // usar real
      }
      
      emModoVirtual = true;
      return false; // continuar no virtual
    }
  }
  
  // ===== MODO INTERMEDIÁRIO =====
  if (modo === 'intermediario') {
    const maxVirtual = parseInt(inpVLoseIntermediarioVirtual.value);
    const maxReal = parseInt(inpVLoseIntermediarioReal.value);
    
    if (emModoVirtual) {
      // Estamos no modo virtual
      if (resultado === 'win') {
        // Win virtual reseta contador virtual
        countVLoseIntermediarioVirtual = 0;
        writeLog("", "[Virtual Loss Intermediário] Win Virtual - Contador virtual resetado");
        return false; // continua no virtual
      } else {
        // Loss virtual
        countVLoseIntermediarioVirtual++;
        writeLog("", "[Virtual Loss Intermediário] Loss Virtual #" + countVLoseIntermediarioVirtual + "/" + maxVirtual);
        
        if (countVLoseIntermediarioVirtual >= maxVirtual) {
          // Atingiu limite de losses virtuais - vai para real
          emModoVirtual = false;
          countVLoseIntermediarioVirtual = 0; // reseta contador virtual
          countVLoseIntermediarioReal = 0;    // reseta contador real
          writeLog("", "[Virtual Loss Intermediário] Limite virtual atingido - Mudando para CONTA REAL");
          return true; // usar real
        }
        
        return false; // continuar no virtual
      }
    } else {
      // Estamos no modo real
      if (resultado === 'win') {
        // Win real volta para virtual
        emModoVirtual = true;
        countVLoseIntermediarioVirtual = 0;
        countVLoseIntermediarioReal = 0;
        writeLog(verdeEscuro, "[Virtual Loss Intermediário] Win Real - Voltando para CONTA VIRTUAL");
        return false; // voltar para virtual
      } else {
        // Loss real
        countVLoseIntermediarioReal++;
        writeLog("", "[Virtual Loss Intermediário] Loss Real #" + countVLoseIntermediarioReal + "/" + maxReal);
        
        if (countVLoseIntermediarioReal >= maxReal) {
          // Atingiu limite de losses reais - volta para virtual
          emModoVirtual = true;
          countVLoseIntermediarioVirtual = 0;
          countVLoseIntermediarioReal = 0;
          writeLog("", "[Virtual Loss Intermediário] Limite real atingido - Voltando para CONTA VIRTUAL");
          return false; // voltar para virtual
        }
        
        return true; // continuar no real
      }
    }
  }
  
  // ===== MODO VIRTUAL WIN =====
  if (modo === 'virtualwin') {
    const maxWins = parseInt(inpVLoseWinVirtual.value);
    
    if (resultado === 'win') {
      // Win virtual incrementa contador
      countVLoseWinVirtual++;
      writeLog("", "[Virtual Win] Win Virtual #" + countVLoseWinVirtual + "/" + maxWins);
      
      if (countVLoseWinVirtual >= maxWins) {
        // Atingiu limite de wins virtuais - próxima em real
        emModoVirtual = false;
        writeLog(verdeEscuro, "[Virtual Win] Limite de wins atingido - Próxima operação em CONTA REAL");
        return true; // usar real
      }
      
      emModoVirtual = true;
      return false; // continuar no virtual
    } else {
      // Loss virtual reseta o contador
      countVLoseWinVirtual = 0;
      emModoVirtual = true;
      writeLog("", "[Virtual Win] Loss Virtual - Contador resetado");
      return false; // continuar no virtual
    }
  }
  
  // ===== MODO PADRÃO VW/VL =====
  if (modo === 'padrao') {
    const sequencia = padraoVLoseSequencia;
    const esperado = sequencia[padraoVLoseAtualIndex];
    const recebido = resultado === 'win' ? 'VW' : 'VL';
    
    writeLog("", "[Padrão VW/VL] Esperado: " + esperado + ", Recebido: " + recebido + " (Índice: " + (padraoVLoseAtualIndex + 1) + "/" + sequencia.length + ")");
    
    if (recebido === esperado) {
      // Resultado corresponde ao esperado - avança no padrão
      padraoVLoseAtualIndex++;
      
      if (padraoVLoseAtualIndex >= sequencia.length) {
        // Padrão completo - próxima em real
        padraoVLoseAtualIndex = 0;
        emModoVirtual = false;
        writeLog(verdeEscuro, "[Padrão VW/VL] Padrão completo [" + sequencia.join(',') + "] - Próxima operação em CONTA REAL");
        return true; // usar real
      }
      
      emModoVirtual = true;
      return false; // continuar no virtual
    } else {
      // Resultado não corresponde - reseta o padrão
      padraoVLoseAtualIndex = 0;
      emModoVirtual = true;
      writeLog("", "[Padrão VW/VL] Padrão quebrado - Resetando");
      return false; // continuar no virtual
    }
  }
  // ===== MODO PROGRESSIVO =====
  if (modo === 'progressivo') {
    const maxVirtualLosses = parseInt(inpVLoseProgressivoVirtual.value);
    const maxRealWins = parseInt(inpVLoseProgressivoRealWins.value);
    
    if (emModoVirtual) {
      // Estamos no modo virtual
      if (resultado === 'win') {
        // Win virtual reseta contador
        countVLoseProgressivoVirtual = 0;
        emModoVirtual = true;
        writeLog("", "[Progressivo] Win Virtual - Contador de perdas resetado");
        return false; // continuar no virtual
      } else {
        // Loss virtual incrementa contador
        countVLoseProgressivoVirtual++;
        writeLog("", "[Progressivo] Loss Virtual #" + countVLoseProgressivoVirtual + "/" + maxVirtualLosses);
        
        if (countVLoseProgressivoVirtual >= maxVirtualLosses) {
          // Atingiu limite de losses virtuais - vai para real
          emModoVirtual = false;
          countVLoseProgressivoVirtual = 0;     // Reseta contador virtual
          countVLoseProgressivoRealWins = 0;    // Reseta contador de wins reais
          writeLog(roxoEscuro, "[Progressivo] Limite de perdas virtuais atingido - Entrando em CONTA REAL");
          return true; // usar real
        }
        
        emModoVirtual = true;
        return false; // continuar no virtual
      }
    } else {
      // Estamos no modo real
      if (resultado === 'win') {
        // Win real incrementa contador de wins consecutivos
        countVLoseProgressivoRealWins++;
        writeLog(verdeEscuro, "[Progressivo] Win Real #" + countVLoseProgressivoRealWins + "/" + maxRealWins + " - Permanecendo em CONTA REAL");
        
        if (countVLoseProgressivoRealWins >= maxRealWins) {
          // Atingiu limite de wins consecutivos - volta para virtual
          emModoVirtual = true;
          countVLoseProgressivoVirtual = 0;
          countVLoseProgressivoRealWins = 0;
          writeLog(verdeEscuro, "[Progressivo] Limite de " + maxRealWins + " wins consecutivos atingido - Voltando para CONTA VIRTUAL");
          return false; // voltar para virtual
        }
        
        emModoVirtual = false;
        return true; // continuar no real
      } else {
        // Loss real volta IMEDIATAMENTE para virtual
        emModoVirtual = true;
        countVLoseProgressivoVirtual = 0;
        countVLoseProgressivoRealWins = 0;
        writeLog("", "[Progressivo] Loss Real - Voltando IMEDIATAMENTE para CONTA VIRTUAL");
        return false; // voltar para virtual
      }
    }
  }
  
  // Fallback - usar real
  return true;
}



const cekValidasiSlaveToken = () => {
  const modo = obterModoVirtualLossAtivo();
  
  // Verifica se Virtual Loss está ativo e requer token slave
  if (modo !== 'nenhum' && getSToken().length == 0) {
    if (btn_run.src.split("/").pop() === "icon_stop.png") {
      btn_run.click();
    }
    chkVLose.checked = false;
    document.getElementById("divPopupVirtualLose").style.display = "none";
    alert("Virtual Loss requer login na conta virtual (Slave Token).\nEfetuar Login na Corretora.");
    return;
  }
};

// ===== VIRTUAL LOSS AVANÇADO - EVENT LISTENERS =====

/**
 * Adiciona todos os event listeners necessários para o Virtual Loss Avançado
 */
function adicionarListenersVirtualLoss() {
  // Listener para alternar entre Simples/Avançado
  selVLoseTipo.addEventListener('change', function() {
    if (this.value === 'simples') {
      divVLoseSimples.style.display = 'block';
      divVLoseAvancado.style.display = 'none';
      // Limpar campos avançados
      selVLoseSubmodo.value = '';
      divVLoseIntermediario.style.display = 'none';
      divVLoseWin.style.display = 'none';
      divVLosePadrao.style.display = 'none';
    } else {
      divVLoseSimples.style.display = 'none';
      divVLoseAvancado.style.display = 'block';
    }
    cekValidasiSlaveToken();
  });
  
  // Listener para selecionar submodo avançado
  /*selVLoseSubmodo.addEventListener('change', function() {
    // Esconder todos
    divVLoseIntermediario.style.display = 'none';
    divVLoseWin.style.display = 'none';
    divVLosePadrao.style.display = 'none';
    
    // Mostrar o selecionado
    if (this.value === 'intermediario') {
      divVLoseIntermediario.style.display = 'block';
      // Limpar outros campos
      inpVLoseWinVirtual.value = '';
      inpVLosePadrao.value = '';
    } else if (this.value === 'virtualwin') {
      divVLoseWin.style.display = 'block';
      // Limpar outros campos
      inpVLoseIntermediarioVirtual.value = '';
      inpVLoseIntermediarioReal.value = '';
      inpVLosePadrao.value = '';
    } else if (this.value === 'padrao') {
      divVLosePadrao.style.display = 'block';
      // Limpar outros campos
      inpVLoseIntermediarioVirtual.value = '';
      inpVLoseIntermediarioReal.value = '';
      inpVLoseWinVirtual.value = '';
    }
    cekValidasiSlaveToken();
  });*/
  selVLoseSubmodo.addEventListener('change', function() {
  // Esconder todos
  divVLoseIntermediario.style.display = 'none';
  divVLoseWin.style.display = 'none';
  divVLosePadrao.style.display = 'none';
  divVLoseProgressivo.style.display = 'none';
  
  // Mostrar o selecionado
  if (this.value === 'intermediario') {
    divVLoseIntermediario.style.display = 'block';
    // Limpar outros campos
    inpVLoseWinVirtual.value = '';
    inpVLosePadrao.value = '';
    inpVLoseProgressivoVirtual.value = '';
    inpVLoseProgressivoRealWins.value = '';
  } else if (this.value === 'virtualwin') {
    divVLoseWin.style.display = 'block';
    // Limpar outros campos
    inpVLoseIntermediarioVirtual.value = '';
    inpVLoseIntermediarioReal.value = '';
    inpVLosePadrao.value = '';
    inpVLoseProgressivoVirtual.value = '';
    inpVLoseProgressivoRealWins.value = '';
  } else if (this.value === 'padrao') {
    divVLosePadrao.style.display = 'block';
    // Limpar outros campos
    inpVLoseIntermediarioVirtual.value = '';
    inpVLoseIntermediarioReal.value = '';
    inpVLoseWinVirtual.value = '';
    inpVLoseProgressivoVirtual.value = '';
    inpVLoseProgressivoRealWins.value = '';
  } else if (this.value === 'progressivo') {
    divVLoseProgressivo.style.display = 'block';
    // Limpar outros campos
    inpVLoseIntermediarioVirtual.value = '';
    inpVLoseIntermediarioReal.value = '';
    inpVLoseWinVirtual.value = '';
    inpVLosePadrao.value = '';
  }
  cekValidasiSlaveToken();
});
  
  // Listener para validar padrão VL/VW quando o usuário digita
  inpVLosePadrao.addEventListener('blur', function() {
    if (this.value.trim().length > 0) {
      validarPadraoVLosePadrao(this.value);
    }
  });
  
  console.log("[VirtualLoss] Event listeners adicionados");
}

// Inicializar listeners quando a página carregar
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', adicionarListenersVirtualLoss);
} else {
  adicionarListenersVirtualLoss();
}

function getStatAccu(agc, agd, age) {
  let agf;
  let agg;
  agg = age * 1 - 1;
  switch (agd) {
    case "1HZ10V":
      agf = [0.00433, 0.00405, 0.0038, 0.00361, 0.00344][agg];
      break;
    case "R_10":
      agf = [0.00613, 0.00573, 0.00537, 0.00511, 0.00486][agg];
      break;
    case "1HZ25V":
      agf = [0.01083, 0.01012, 0.00949, 0.00903, 0.0086][agg];
      break;
    case "R_25":
      agf = [0.01531, 0.01431, 0.01342, 0.01277, 0.01216][agg];
      break;
    case "1HZ50V":
      agf = [0.02166, 0.02024, 0.01898, 0.01806, 0.01719][agg];
      break;
    case "R_50":
      agf = [0.03063, 0.02863, 0.02685, 0.02554, 0.02431][agg];
      break;
    case "1HZ75V":
      agf = [0.03249, 0.03036, 0.02847, 0.02709, 0.02579][agg];
      break;
    case "R_75":
      agf = [0.04594, 0.04294, 0.04027, 0.03831, 0.03647][agg];
      break;
    case "1HZ100V":
      agf = [0.04331, 0.04048, 0.03797, 0.03612, 0.03438][agg];
      break;
    case "R_100":
      agf = [0.06126, 0.05725, 0.05369, 0.05109, 0.04863][agg];
      break;
    default:
      break;
  }
  let agh;
  let agi;
  let agj;
  let agk;
  agk = 0;
  for (i = agc.length - 1; i > 0; i--) {
    agh = agc[i - 1] * agf / 100;
    agi = agc[i - 1] + agh;
    agj = agc[i - 1] - agh;
    if (agc[i] < agi && agc[i] > agj) {
      agk++;
    } else {
      break;
    }
  }
  return agk * 1;
}
const continuousindices_show = agl => {
  document.getElementById("continuousindices_" + agl + "_ticks").value = document.getElementById("continuousindices_" + agl + "_digits").value = "";
  document.getElementById("continuousindices_" + agl + "_ticks").hidden = document.getElementById("continuousindices_" + agl + "_digits").hidden = false;
};
const continuousindices_hide = agm => {
  document.getElementById("continuousindices_" + agm + "_ticks").value = document.getElementById("continuousindices_" + agm + "_digits").value = "";
  document.getElementById("continuousindices_" + agm + "_ticks").hidden = document.getElementById("continuousindices_" + agm + "_digits").hidden = true;
};
const continuousindices_activeChanged = (agn, ago) => {
  if (ago) {
    subscribeTicks("continuousindices", agn, arrMarket_Continuous[agn - 1]);
    continuousindices_show(agn);
  } else {
    if (idSubTicksHistory_continuous[agn] != 0) {
      forgetTicks(idSubTicksHistory_continuous[agn]);
    }
    continuousindices_hide(agn);
  }
};
// ===== INICIALIZAÇÃO DOS WEBSOCKETS =====
// Usuários legados: WS criado imediatamente com URL legada + ReconnectingWebSocket
// Usuários nova API: WS criado depois em setupNewApiWebSockets() com URL OTP
// Guarda extra: durante callback OAuth (?code=) não cria conexão legada
const _isOAuthCallback = window.location.search.includes('code=') || window.location.search.includes('error=');
if (localStorage.getItem('deriv_is_new_api') !== '1' && !_isOAuthCallback) {
    vEval = eval(" new ReconnectingW" + am);
    vEval.addEventListener("open", openResponse);
    vEval.addEventListener("message", messageResponse);
    vEval.addEventListener("close", closeResponse);
    v = eval(" new ReconnectingW" + am);
    v.addEventListener("open", openResponseV);
    v.addEventListener("message", messageResponseV);
    v.addEventListener("close", closeResponseV);
}
selMarket.addEventListener("change", marketChanged);
selSubMarket.addEventListener("change", subMarketChanged);
selSymbol.addEventListener("change", function () {
  mainSymbol = this.value;
  document.getElementById("lblMarket").innerText = selSymbol.options[selSymbol.selectedIndex].text;
  forgetAllTicks();
});
inpNOTicks.addEventListener("change", forgetAllTicks);
btn_run.addEventListener("click", btn_runClickResponse);
btn_run2.addEventListener("click", function () {
  btn_run.click();
});
selData.addEventListener("change", function () {
  refreshBoxData(this.value);
});
Blockly.getMainWorkspace().addChangeListener(blockly_workspaceChangedResponse);
document.getElementById("btn_reset").addEventListener("click", blockly_reset);

// Atualizar o evento do input file para usar a mesma função
document.getElementById("input_file").addEventListener("change", function() {
    if (this.files.length) {
        loadFileToJsonObj(this.files[0]);
    }
});

document.getElementById("btn_load").addEventListener("click", function () {
  document.getElementById("input_file").click();
});
document.getElementById("btn_save").addEventListener("click", blockly_save);
document.getElementById("btn_undo").addEventListener("click", blockly_undo);
document.getElementById("btn_redo").addEventListener("click", blockly_redo);
document.getElementById("btn_arrange").addEventListener("click", blockly_arrange);
document.getElementById("mydivSummary").addEventListener("mousedown", moveBoxSummaryTop);
document.getElementById("btn_summary").addEventListener("click", function () {
  if (document.getElementById("mydivSummary").style.display == "block") {
    closeBoxSummary();
  } else {
    showBoxSummary();
  }
});
document.getElementById("btn_closeBoxSummary").addEventListener("click", closeBoxSummary);
document.getElementById("mydivLog").addEventListener("mousedown", moveBoxLogTop);
document.getElementById("btn_log").addEventListener("click", function () {
  if (document.getElementById("mydivLog").style.display == "flex") {
    closeBoxLog();
  } else {
    showBoxLog();
  }
});
//document.getElementById("mydivTW").addEventListener("mousedown", moveBoxTWTop);
document.getElementById("btn_hideshowtw").addEventListener("click", function() {
    window.open("https://charts.deriv.com");
});
//document.getElementById("btn_closeBoxTW").addEventListener("click", closeBoxTW);

document.getElementById("btn_calc2").addEventListener("click", function () {
  window.open("https://pontobots.com/calculadora");
});

var toggleNotification = false;
var toggleButton = document.getElementById("btn_logleft");
toggleButton.addEventListener("click", function() {
  toggleNotification = !toggleNotification; 
});
document.getElementById("btn_clearBoxSummary").addEventListener("click", clearBoxSummary);
document.getElementById("btn_saveBoxSummary").addEventListener("click", function () {
  tableToCSV("tableSummaryTBODY", "", "Block_Summary.csv");
});
document.getElementById("btn_clearBoxLog").addEventListener("click", clearBoxLog);
document.getElementById("btn_saveBoxLog").addEventListener("click", function () {
  tableToCSV("tableLogTBODY", "Timestamp,Message", "Block_Log.csv");
});
document.getElementById("btn_closeBoxLog").addEventListener("click", closeBoxLog);
document.getElementById("btn_hideshowsidebar").addEventListener("click", hideshowsidebar);
document.getElementById("btn_hideshowdatabox").addEventListener("click", hideshowdatabox);
document.getElementById("btn_hideshowtoolbox").addEventListener("click", hideshowtoolbox);
selMoneyManagement.addEventListener("change", selMoneyManagementChanged);
for (i = 1; i <= 6; i++) {
  digitstatistic_noofticks[i].addEventListener("change", function () {
    if (this.value > 1000) {
      this.value = 1000;
      localStorage.setItem(this.id, this.value);
    }
  });
}
for (i = 1; i <= 6; i++) {
  evenvsodd_noofticks[i].addEventListener("change", function () {
    if (this.value > 1000) {
      this.value = 1000;
      localStorage.setItem(this.id, this.value);
    }
  });
}
for (i = 1; i <= 2; i++) {
  overvsunder_noofticks[i].addEventListener("change", function () {
    if (this.value > 1000) {
      this.value = 1000;
      localStorage.setItem(this.id, this.value);
    }
  });
}
for (i = 1; i <= 6; i++) {
  risevsfall_noofticks[i].addEventListener("change", function () {
    if (this.value > 1000) {
      this.value = 1000;
      localStorage.setItem(this.id, this.value);
    }
  });
}
for (i = 1; i <= 3; i++) {
  inpTickTrisma_period[i].addEventListener("change", function () {
    if (this.value > 200) {
      this.value = 200;
      localStorage.setItem(this.id, this.value);
    }
  });
}
for (i = 1; i <= 10; i++) {
  if (continuousindices_active[i].checked) {
    continuousindices_show(i);
  } else {
    continuousindices_hide(i);
  }
  ;
  continuousindices_active[i].addEventListener("change", function () {
    continuousindices_activeChanged(this.id.split("_")[1] * 1, this.checked);
  });
}
document.getElementById("btnhead_deriv").addEventListener("click", function () {
  window.open("https://track.deriv.com/_iTuuycsEe_dZl7VyVw174GNd7ZgqdRLk/1/");
});
document.getElementById("btnhead_youtube").addEventListener("click", function () {
  window.open("https://www.youtube.com/playlist?list=PLyxrfb4MWVE1auvG_86xvel_qjrjyBvEh");
});
document.getElementById("btn_home").addEventListener("click", function () {
  window.open("https://pontobots.com/index(4).html");
});
document.getElementById("btn_home2").addEventListener("click", function () {
  window.open("https://pontobots.com/index(4).html");
});
document.getElementById("btn_calc").addEventListener("click", function () {
  window.open("https://pontobots.com/calculadora");
});
document.getElementById("btn_teleg").addEventListener("click", function () {
  window.open("https://t.me/pontobots");
});
document.getElementById("btn_teleg2").addEventListener("click", function () {
  window.open("https://t.me/pontobots");
});
document.getElementById("btnsimp_deriv").addEventListener("click", function () {
  window.open("https://track.deriv.com/_iTuuycsEe_dZl7VyVw174GNd7ZgqdRLk/1/");
});
document.getElementById("btnsimp_youtube").addEventListener("click", function () {
  window.open("https://www.youtube.com/playlist?list=PLyxrfb4MWVE1auvG_86xvel_qjrjyBvEh");
});

document.getElementById("btn_CreateAccount").addEventListener("click", function () {
  window.open("https://track.deriv.com/_iTuuycsEe_dZl7VyVw174GNd7ZgqdRLk/1/");
});
document.getElementById("btn_CreateToken").addEventListener("click", function () {
  window.open("https://app.deriv.com/account/api-token");
});
document.getElementById("btnSwitchToSimple").addEventListener("click", switchtosimplemode);
document.getElementById("btnSwitchToAdvanced").addEventListener("click", switchtoadvancedmode);

document.getElementById("btnSimpleRobot").addEventListener("click", function () {
  document.getElementById("divPopupRobot").style.display = "block";
  document.getElementById("myInput2").focus();
});
document.getElementById("btnAdvancedRobot").addEventListener("click", function () {
  document.getElementById("divPopupRobot").style.display = "block";
  document.getElementById("myInput2").focus();
});
btnSimpleRun.addEventListener("click", function () {
  btn_run.click();
});
document.getElementById("btnSimpleLogsBox").addEventListener("click", function () {
  document.getElementById("btn_log").click();
});
document.getElementById("btnSimpleSummaryBox").addEventListener("click", function () {
  document.getElementById("btn_summary").click();
});
chkVLose.addEventListener("change", cekValidasiSlaveToken);

/*
const mainLogic = () => {
  updateStepper(1);
  if (!chkVLose.checked || inpVLose.value <= 0) {
    conn_nya = vEval;
  } else {
    if (chkVLose.checked && countVLose < inpVLose.value) {
      if (!slaveAuthorized) {
        return;
      }
      conn_nya = v;
    } else {
      conn_nya = vEval;
    }
  }
  if (Date.now() >= timeMayOP && navigator.onLine && !sedangForgetAllTicks) {
    func$1$9$8$7$PurchaseConditions();
  }
};
*/

const mainLogic = () => {
  updateStepper(1);
  
  const modo = obterModoVirtualLossAtivo();

    if (modo === 'nenhum') {
     // Virtual Loss desativado - usar conta real
     conn_nya = vEval;
    } else {
     // Virtual Loss ativo - verificar se deve usar virtual ou real
     if (emModoVirtual) {
      // Usar conta virtual
     // FIX v004: nova API também exige slaveAuthorized — removido bypass
     if (!slaveAuthorized) {
        return;
     }
     conn_nya = v;
     } else {
      // Usar conta real
      conn_nya = vEval;
     }
    }
  
  // FIX v003: Guard clause - WS deve estar pronto
  if (!conn_nya || conn_nya.readyState !== 1) {
    return;
  }
  
  if (Date.now() >= timeMayOP && navigator.onLine && !sedangForgetAllTicks) {
    func$1$9$8$7$PurchaseConditions();
  }
};


/*document.getElementById("btnSimpleToken").style.opacity = */document.getElementById("btnSimpleRobot").style.opacity = document.getElementById("btnSimpleSummaryBox").style.opacity = document.getElementById("btnSimpleLogsBox").style.opacity = document.getElementById("btnSwitchToAdvanced").style.opacity = 1;
if (localStorage.getItem("initStateMode") == "simple") {
  switchtosimplemode();
} else {
  if (localStorage.getItem("initStateMode") == "advanced") {
    switchtoadvancedmode();
  }
}
const getAndEvalJavaScriptCode = () => {
  window.LoopTrap = 999999;
  javascript.javascriptGenerator.INFINITE_LOOP_TRAP = "if(--window.LoopTrap == 0) throw \"Infinite loop.\";\n";
  Blockly.JavaScript.init(workspace);
  try {
    eval(mainWorkspaceCode);
  } catch (e) {
    console.log(e);
  } finally {
    
    
    setTimeout(() => {
      func$1$9$8$7$RunOnceAtStart();
    }, 100);
  }
};



function setupDragAndDrop() {
    const workspaceContainer = document.getElementById('blocklyDiv'); // Elemento que contém o workspace
    
    // Prevenir comportamentos padrão
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        workspaceContainer.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });
    
    // Adicionar efeito visual durante o drag
    ['dragenter', 'dragover'].forEach(eventName => {
        workspaceContainer.addEventListener(eventName, highlightArea, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        workspaceContainer.addEventListener(eventName, unhighlightArea, false);
    });
    
    // Lidar com o arquivo solto
    workspaceContainer.addEventListener('drop', handleDrop, false);

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    function highlightArea() {
        workspaceContainer.classList.add('dragover');
    }

    function unhighlightArea() {
        workspaceContainer.classList.remove('dragover');
    }

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        
        if (files.length && files[0].name.endsWith('.ptbot')) {
            loadFileToJsonObj(files[0]);
        }
    }
}

// Adicionar estilos CSS para feedback visual
const style = document.createElement('style');
style.innerHTML = `
    #blocklyDiv.dragover {
        border: 3px dashed #4CAF50 !important;
        background-color: rgba(76, 175, 80, 0.1) !important;
    }
`;
document.head.appendChild(style);


document.addEventListener('DOMContentLoaded', () => {
    registerContextMenuItems();
    setupDragAndDrop();
    
    // Adicionar tooltip para UX
    const tooltip = document.createElement('div');
    tooltip.id = 'drag-tooltip';
    tooltip.innerHTML = 'Arraste arquivos .ptbot aqui para carregar bots';
    tooltip.style = `
        position: absolute;
        top: 10px;
        right: 10px;
        background: rgba(0,0,0,0.7);
        color: white;
        padding: 5px 10px;
        border-radius: 4px;
        font-size: 12px;
        z-index: 1000;
        display: none;
    `;
    document.getElementById('blocklyDiv').appendChild(tooltip);
    
    // Mostrar/ocultar tooltip
    const workspace = document.getElementById('blocklyDiv');
    workspace.addEventListener('dragenter', () => {
        tooltip.style.display = 'block';
    });
    workspace.addEventListener('dragleave', () => {
        tooltip.style.display = 'none';
    });
    workspace.addEventListener('drop', () => {
        tooltip.style.display = 'none';
    });
});