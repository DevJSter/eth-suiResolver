// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title WSUIToken
 * @dev ERC20 token representing wrapped SUI on Ethereum
 */
contract WSUIToken is IERC20, Ownable, Pausable {
    using SafeERC20 for IERC20;

    string public constant name = "Wrapped SUI";
    string public constant symbol = "wSUI";
    uint8 public constant decimals = 9; // SUI has 9 decimals

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    // Minting and burning roles
    mapping(address => bool) public minters;
    mapping(address => bool) public burners;

    event Mint(address indexed to, uint256 amount, bytes32 indexed suiTxHash);
    event Burn(address indexed from, uint256 amount, string suiAddress);
    event MinterAdded(address indexed minter);
    event MinterRemoved(address indexed minter);
    event BurnerAdded(address indexed burner);
    event BurnerRemoved(address indexed burner);

    modifier onlyMinter() {
        require(minters[msg.sender], "WSUIToken: caller is not a minter");
        _;
    }

    modifier onlyBurner() {
        require(burners[msg.sender], "WSUIToken: caller is not a burner");
        _;
    }

    constructor() {
        _transferOwnership(msg.sender);
        minters[msg.sender] = true;
        burners[msg.sender] = true;
    }

    function totalSupply() public view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view override returns (uint256) {
        return _balances[account];
    }

    function transfer(address to, uint256 amount) public override whenNotPaused returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function allowance(address owner, address spender) public view override returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) public override whenNotPaused returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override whenNotPaused returns (bool) {
        uint256 currentAllowance = _allowances[from][msg.sender];
        require(currentAllowance >= amount, "ERC20: transfer amount exceeds allowance");

        _transfer(from, to, amount);
        _approve(from, msg.sender, currentAllowance - amount);

        return true;
    }

    /**
     * @dev Mint wSUI tokens when SUI is locked on Sui network
     * @param to Address to mint tokens to
     * @param amount Amount to mint
     * @param suiTxHash Transaction hash on Sui network for verification
     */
    function mint(address to, uint256 amount, bytes32 suiTxHash) external onlyMinter whenNotPaused {
        require(to != address(0), "WSUIToken: mint to the zero address");
        require(amount > 0, "WSUIToken: mint amount must be greater than 0");

        _totalSupply += amount;
        _balances[to] += amount;

        emit Transfer(address(0), to, amount);
        emit Mint(to, amount, suiTxHash);
    }

    /**
     * @dev Burn wSUI tokens to unlock SUI on Sui network
     * @param from Address to burn tokens from
     * @param amount Amount to burn
     * @param suiAddress SUI address to unlock tokens to
     */
    function burn(address from, uint256 amount, string calldata suiAddress) external onlyBurner whenNotPaused {
        require(from != address(0), "WSUIToken: burn from the zero address");
        require(amount > 0, "WSUIToken: burn amount must be greater than 0");
        require(_balances[from] >= amount, "WSUIToken: burn amount exceeds balance");
        require(bytes(suiAddress).length > 0, "WSUIToken: invalid SUI address");

        _balances[from] -= amount;
        _totalSupply -= amount;

        emit Transfer(from, address(0), amount);
        emit Burn(from, amount, suiAddress);
    }

    function addMinter(address minter) external onlyOwner {
        require(minter != address(0), "WSUIToken: minter is the zero address");
        minters[minter] = true;
        emit MinterAdded(minter);
    }

    function removeMinter(address minter) external onlyOwner {
        minters[minter] = false;
        emit MinterRemoved(minter);
    }

    function addBurner(address burner) external onlyOwner {
        require(burner != address(0), "WSUIToken: burner is the zero address");
        burners[burner] = true;
        emit BurnerAdded(burner);
    }

    function removeBurner(address burner) external onlyOwner {
        burners[burner] = false;
        emit BurnerRemoved(burner);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");
        require(_balances[from] >= amount, "ERC20: transfer amount exceeds balance");

        _balances[from] -= amount;
        _balances[to] += amount;

        emit Transfer(from, to, amount);
    }

    function _approve(address owner, address spender, uint256 amount) internal {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }
}