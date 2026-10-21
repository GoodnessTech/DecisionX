// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title DecisionX
 * @author DecisionX Protocol
 * @notice Parimutuel decision-market protocol allowing organizations and DAOs
 *         to compare alternative decisions using financially backed market signals.
 * @dev Gas-optimized: single self-contained contract, packed storage slots,
 *      native BOT settlement, pull-based claims, and custom errors.
 */
contract DecisionX {
    // --- Custom Errors (Gas Optimization over string reverts) ---
    error InvalidOptionCount();
    error InvalidTimestamps();
    error ZeroResolver();
    error MarketNotOpen();
    error ForecastWindowClosed();
    error ForecastWindowStillOpen();
    error InvalidOption();
    error ZeroStake();
    error Unauthorized();
    error InvalidStatusForResolution();
    error MarketNotResolved();
    error MarketNotCancelled();
    error AlreadyClaimed();
    error NoWinningPosition();
    error NothingToRefund();
    error TransferFailed();
    error ReentrancyGuardReentrantCall();
    error ResolutionDeadlineNotExceeded();

    // --- Enums & Structs ---
    enum MarketStatus {
        Open,       // Accepting forecast stakes
        Closed,     // Forecast window closed; awaiting result publication
        Resolved,   // Winning outcome published; claims active
        Cancelled   // Cancelled; 100% staker refunds active
    }

    struct DecisionCore {
        address creator;           // 20 bytes | Slot 0
        uint64 createdAt;          //  8 bytes | Slot 0
        uint32 optionCount;        //  4 bytes | Slot 0 (32 bytes total)

        address resolver;          // 20 bytes | Slot 1
        uint64 forecastCutoff;     //  8 bytes | Slot 1
        uint32 winningOption;      //  4 bytes | Slot 1 (32 bytes total)

        uint64 resolutionDeadline; //  8 bytes | Slot 2
        MarketStatus status;       //  1 byte  | Slot 2
        // 23 bytes free in Slot 2

        uint256 totalPool;         // 32 bytes | Slot 3
    }

    struct DecisionMetadata {
        string title;
        string organization;
        string metric;
        string criteriaUriOrHash;
        string evidenceUri;
    }

    struct CreateDecisionParams {
        string title;
        string organization;
        string metric;
        string criteriaUriOrHash;
        string[] options;
        uint64 forecastCutoff;
        uint64 resolutionDeadline;
        address resolver;
    }

    // --- State Variables ---
    uint256 public decisionCount;

    // decisionId => DecisionCore
    mapping(uint256 => DecisionCore) public decisions;

    // decisionId => DecisionMetadata
    mapping(uint256 => DecisionMetadata) public metadata;

    // decisionId => optionIndex => optionName
    mapping(uint256 => mapping(uint32 => string)) public optionNames;

    // decisionId => optionIndex => totalStakedOnOption
    mapping(uint256 => mapping(uint32 => uint256)) public optionPools;

    // decisionId => user => optionIndex => userStake
    mapping(uint256 => mapping(address => mapping(uint32 => uint256))) public userStakes;

    // decisionId => user => totalStakeAcrossAllOptions
    mapping(uint256 => mapping(address => uint256)) public userTotalStake;

    // decisionId => user => claimed
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    // Reentrancy lock (Slot 4)
    uint256 private _reentrancyStatus;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    // --- Events ---
    event DecisionCreated(
        uint256 indexed decisionId,
        address indexed creator,
        address indexed resolver,
        uint64 forecastCutoff,
        uint64 resolutionDeadline,
        uint32 optionCount,
        string title
    );

    event PositionStaked(
        uint256 indexed decisionId,
        address indexed participant,
        uint32 indexed optionIndex,
        uint256 amount,
        uint256 optionPool,
        uint256 totalPool
    );

    event ForecastClosed(uint256 indexed decisionId);

    event DecisionResolved(
        uint256 indexed decisionId,
        uint32 indexed winningOptionIndex,
        uint256 winningPool,
        uint256 totalPool,
        string evidenceUri
    );

    event DecisionCancelled(uint256 indexed decisionId, string reason);

    event WinningsClaimed(
        uint256 indexed decisionId,
        address indexed participant,
        uint256 payout
    );

    event RefundClaimed(
        uint256 indexed decisionId,
        address indexed participant,
        uint256 amount
    );

    // --- Modifiers ---
    modifier nonReentrant() {
        if (_reentrancyStatus == _ENTERED) revert ReentrancyGuardReentrantCall();
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    constructor() {
        _reentrancyStatus = _NOT_ENTERED;
    }

    // --- Core Lifecycle Functions ---

    /**
     * @notice Create a new decision market comparing 2 to 8 distinct options.
     * @param params CreateDecisionParams struct in calldata containing decision details.
     * @return decisionId Unique identifier for the created decision.
     */
    function createDecision(
        CreateDecisionParams calldata params
    ) external returns (uint256 decisionId) {
        uint256 count = params.options.length;
        if (count < 2 || count > 8) revert InvalidOptionCount();
        if (params.forecastCutoff <= block.timestamp || params.resolutionDeadline < params.forecastCutoff) {
            revert InvalidTimestamps();
        }
        if (params.resolver == address(0)) revert ZeroResolver();

        decisionId = ++decisionCount;

        DecisionCore storage d = decisions[decisionId];
        d.creator = msg.sender;
        d.createdAt = uint64(block.timestamp);
        d.optionCount = uint32(count);
        d.resolver = params.resolver;
        d.forecastCutoff = params.forecastCutoff;
        d.resolutionDeadline = params.resolutionDeadline;
        d.status = MarketStatus.Open;

        DecisionMetadata storage m = metadata[decisionId];
        m.title = params.title;
        m.organization = params.organization;
        m.metric = params.metric;
        m.criteriaUriOrHash = params.criteriaUriOrHash;

        for (uint32 i = 0; i < count; ) {
            optionNames[decisionId][i] = params.options[i];
            unchecked { ++i; }
        }

        emit DecisionCreated(
            decisionId,
            msg.sender,
            params.resolver,
            params.forecastCutoff,
            params.resolutionDeadline,
            uint32(count),
            params.title
        );
    }

    /**
     * @notice Stake native BOT on a specific option to forecast its outcome.
     * @param decisionId Identifier of the decision.
     * @param optionIndex Index of the option (0-indexed).
     */
    function stake(uint256 decisionId, uint32 optionIndex) external payable nonReentrant {
        if (msg.value == 0) revert ZeroStake();

        DecisionCore storage d = decisions[decisionId];
        if (d.status != MarketStatus.Open) revert MarketNotOpen();
        if (block.timestamp >= d.forecastCutoff) revert ForecastWindowClosed();
        if (optionIndex >= d.optionCount) revert InvalidOption();

        // Update state
        userStakes[decisionId][msg.sender][optionIndex] += msg.value;
        userTotalStake[decisionId][msg.sender] += msg.value;
        optionPools[decisionId][optionIndex] += msg.value;
        d.totalPool += msg.value;

        emit PositionStaked(
            decisionId,
            msg.sender,
            optionIndex,
            msg.value,
            optionPools[decisionId][optionIndex],
            d.totalPool
        );
    }

    /**
     * @notice Explicitly mark the forecast window as closed once cutoff timestamp has passed.
     * @dev Staking is automatically blocked past cutoff; this explicitly updates status to Closed.
     * @param decisionId Identifier of the decision.
     */
    function closeForecast(uint256 decisionId) external {
        DecisionCore storage d = decisions[decisionId];
        if (d.status != MarketStatus.Open) revert MarketNotOpen();
        if (block.timestamp < d.forecastCutoff) revert ForecastWindowStillOpen();

        d.status = MarketStatus.Closed;
        emit ForecastClosed(decisionId);
    }

    /**
     * @notice Publish verifiable results and settle the decision market.
     * @dev Only the designated resolver may resolve the market once forecast window has closed.
     * @param decisionId Identifier of the decision.
     * @param winningOptionIndex Index of the winning option.
     * @param evidenceUri Link, IPFS hash, or reference to the verifiable evidence.
     */
    function resolveDecision(
        uint256 decisionId,
        uint32 winningOptionIndex,
        string calldata evidenceUri
    ) external {
        DecisionCore storage d = decisions[decisionId];
        if (msg.sender != d.resolver) revert Unauthorized();
        if (d.status != MarketStatus.Open && d.status != MarketStatus.Closed) {
            revert InvalidStatusForResolution();
        }
        if (block.timestamp < d.forecastCutoff) revert ForecastWindowStillOpen();
        if (winningOptionIndex >= d.optionCount) revert InvalidOption();

        d.status = MarketStatus.Resolved;
        d.winningOption = winningOptionIndex;
        metadata[decisionId].evidenceUri = evidenceUri;

        emit DecisionResolved(
            decisionId,
            winningOptionIndex,
            optionPools[decisionId][winningOptionIndex],
            d.totalPool,
            evidenceUri
        );
    }

    /**
     * @notice Claim winnings for a resolved decision market.
     * @dev Pull-based claim preventing loops. Payout is proportional to stake in the winning pool:
     *      payout = (userWinningStake * totalPool) / winningPool.
     *      If winningPool == 0 (no stakers on winning option), stakers receive 100% refund.
     * @param decisionId Identifier of the decision.
     */
    function claimWinnings(uint256 decisionId) external nonReentrant {
        DecisionCore storage d = decisions[decisionId];
        if (d.status != MarketStatus.Resolved) revert MarketNotResolved();
        if (hasClaimed[decisionId][msg.sender]) revert AlreadyClaimed();

        uint32 winOpt = d.winningOption;
        uint256 winPool = optionPools[decisionId][winOpt];
        uint256 payout;

        if (winPool == 0) {
            // Invariant fallback: No stakers on the winning option; refund participant's total deposit
            payout = userTotalStake[decisionId][msg.sender];
            if (payout == 0) revert NoWinningPosition();
        } else {
            uint256 userStake = userStakes[decisionId][msg.sender][winOpt];
            if (userStake == 0) revert NoWinningPosition();
            payout = (userStake * d.totalPool) / winPool;
        }

        hasClaimed[decisionId][msg.sender] = true;

        (bool sent, ) = payable(msg.sender).call{value: payout}("");
        if (!sent) revert TransferFailed();

        emit WinningsClaimed(decisionId, msg.sender, payout);
    }

    /**
     * @notice Cancel a decision and enable full refunds for all stakers.
     * @dev Callable by resolver/creator at any time before resolution, or by ANYONE
     *      if resolutionDeadline has passed without resolution (abandonment protection).
     * @param decisionId Identifier of the decision.
     * @param reason Description of why the market was cancelled.
     */
    function cancelDecision(uint256 decisionId, string calldata reason) external {
        DecisionCore storage d = decisions[decisionId];
        if (d.status != MarketStatus.Open && d.status != MarketStatus.Closed) {
            revert InvalidStatusForResolution();
        }

        bool isAuth = (msg.sender == d.resolver || msg.sender == d.creator);
        bool deadlinePassed = (block.timestamp > d.resolutionDeadline);

        if (!isAuth && !deadlinePassed) {
            revert Unauthorized();
        }

        d.status = MarketStatus.Cancelled;
        emit DecisionCancelled(decisionId, reason);
    }

    /**
     * @notice Claim a 100% refund of deposited stakes for a cancelled decision.
     * @param decisionId Identifier of the decision.
     */
    function claimRefund(uint256 decisionId) external nonReentrant {
        DecisionCore storage d = decisions[decisionId];
        if (d.status != MarketStatus.Cancelled) revert MarketNotCancelled();
        if (hasClaimed[decisionId][msg.sender]) revert AlreadyClaimed();

        uint256 refundAmount = userTotalStake[decisionId][msg.sender];
        if (refundAmount == 0) revert NothingToRefund();

        hasClaimed[decisionId][msg.sender] = true;

        (bool sent, ) = payable(msg.sender).call{value: refundAmount}("");
        if (!sent) revert TransferFailed();

        emit RefundClaimed(decisionId, msg.sender, refundAmount);
    }

    // --- View Functions ---

    /**
     * @notice Get complete decision details for frontend consumption.
     */
    function getDecision(uint256 decisionId)
        external
        view
        returns (
            DecisionCore memory core,
            DecisionMetadata memory meta,
            string[] memory options,
            uint256[] memory pools
        )
    {
        core = decisions[decisionId];
        meta = metadata[decisionId];

        uint32 count = core.optionCount;
        options = new string[](count);
        pools = new uint256[](count);

        for (uint32 i = 0; i < count; ) {
            options[i] = optionNames[decisionId][i];
            pools[i] = optionPools[decisionId][i];
            unchecked { ++i; }
        }
    }

    /**
     * @notice Get user position across all options for a specific decision.
     */
    function getUserPosition(uint256 decisionId, address user)
        external
        view
        returns (
            uint256[] memory stakesByOption,
            uint256 totalUserStake,
            bool claimed
        )
    {
        uint32 count = decisions[decisionId].optionCount;
        stakesByOption = new uint256[](count);
        for (uint32 i = 0; i < count; ) {
            stakesByOption[i] = userStakes[decisionId][user][i];
            unchecked { ++i; }
        }
        totalUserStake = userTotalStake[decisionId][user];
        claimed = hasClaimed[decisionId][user];
    }
}
